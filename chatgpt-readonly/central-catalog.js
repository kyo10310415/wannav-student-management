import { createRequire } from "node:module";
import { fetchSatisfactionFromCache } from "../src/services/cacheService.js";
const base = createRequire(import.meta.url)("./catalog.json");
export function createCatalog(
  fetchSatisfaction = fetchSatisfactionFromCache,
  env = process.env,
) {
  return {
    ...base,
    satisfaction: {
      title:
        "中央管理：Google Sheetsキャッシュの満足度回答。satisfaction_scoreは0〜10。EPの1〜5段階とは別指標。year_monthはYYYY-MM",
      fields: {
        student_id: "text",
        student_name: "text",
        tutor_name: "text",
        year_month: "text",
        timestamp: "text",
        satisfaction_score: "number",
        reason: "text",
        empathy_score: "number",
        advice_score: "number",
        clarity_score: "number",
        approachability_score: "number",
      },
      history: "event_cached",
      order: ["student_id", "timestamp"],
      async load() {
        const sheet = env.GOOGLE_CACHE_SHEET_ID || env.GOOGLE_SHEET_ID;
        if (!sheet) throw new Error("Satisfaction source is not configured");
        const records = await fetchSatisfaction(sheet);
        return records.map((row) =>
          Object.fromEntries(
            Object.entries(this.fields).map(([key, type]) => {
              let value = row[key];
              if (key === "year_month") {
                const m = /^(\d{4})[/-](0?[1-9]|1[0-2])$/.exec(
                  String(value || ""),
                );
                value = m ? m[1] + "-" + m[2].padStart(2, "0") : null;
              }
              return [
                key,
                type === "number"
                  ? value !== null &&
                    value !== undefined &&
                    String(value).trim() !== "" &&
                    Number.isFinite(Number(value))
                    ? Number(value)
                    : null
                  : (value ?? null),
              ];
            }),
          ),
        );
      },
    },
  };
}
export const catalog = createCatalog();
