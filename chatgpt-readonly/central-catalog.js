import { createRequire } from "node:module";
import reader from "./reader.cjs";
import { fetchSatisfactionFromCache } from "../src/services/cacheService.js";
const base = createRequire(import.meta.url)("./catalog.json");
export function createCatalog(
  fetchSatisfaction = fetchSatisfactionFromCache,
  env = process.env,
) {
  let inFlight;
  function records(sheet) {
    if (!inFlight)
      inFlight = Promise.resolve()
        .then(() => fetchSatisfaction(sheet, { timeout: 30000, retry: false }))
        .finally(() => {
          inFlight = undefined;
        });
    return inFlight;
  }
  function valueAt(row, key, type) {
    let value = row[key];
    if (key === "year_month") {
      const m = /^(\d{4})[/-](0?[1-9]|1[0-2])$/.exec(String(value || ""));
      value = m ? m[1] + "-" + m[2].padStart(2, "0") : null;
    }
    return type === "number"
      ? value !== null &&
        value !== undefined &&
        String(value).trim() !== "" &&
        Number.isFinite(Number(value))
        ? Number(value)
        : null
      : (value ?? null);
  }
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
      async load(_db, request = {}) {
        const sheet = env.GOOGLE_CACHE_SHEET_ID || env.GOOGLE_SHEET_ID;
        if (!sheet) throw new Error("Satisfaction source is not configured");
        const all = await records(sheet),
          selected = [];
        const fields = Object.entries(this.fields);
        for (const row of all) {
          const filtersMatch = (request.filters || []).every((f) => {
            const value = valueAt(row, f.field, this.fields[f.field]);
            if (value === null) return false;
            if (f.op === "eq") return String(value) === String(f.value);
            if (f.op === "contains")
              return String(value)
                .toLowerCase()
                .includes(String(f.value).toLowerCase());
            return f.op === "gte" ? value >= f.value : value < f.value;
          });
          if (!filtersMatch) continue;
          if (
            request.q &&
            !fields.some(
              ([key, type]) =>
                type === "text" &&
                String(valueAt(row, key, type) ?? "")
                  .toLowerCase()
                  .includes(request.q.toLowerCase()),
            )
          )
            continue;
          selected.push(
            Object.fromEntries(
              fields.map(([key, type]) => [key, valueAt(row, key, type)]),
            ),
          );
          // One extra matching row makes the shared reader report truncation.
          if (selected.length === reader.MAX_ROWS + 1) break;
        }
        return selected;
      },
    },
  };
}
export const catalog = createCatalog();
