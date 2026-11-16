import { PGlite } from "@electric-sql/pglite";
import { readFile } from "node:fs/promises";
import { createRequire } from "node:module";
import { DatabaseSync } from "node:sqlite";
const require = createRequire(import.meta.url);
if (!process.env.WANNAV_SOURCE_ROOT)
  throw new Error(
    "Set WANNAV_SOURCE_ROOT to the directory containing all source repository checkouts",
  );
const root = process.env.WANNAV_SOURCE_ROOT.replace(/\/$/, "") + "/";
function ddl(source, table) {
  const re = new RegExp(
    "CREATE TABLE IF NOT EXISTS " + table + "\\s*\\(([\\s\\S]*?)\\n\\s*\\)",
  );
  const match = source.match(re);
  if (!match) throw new Error("DDL missing " + table);
  const body = match[1]
    .replace(/,?\n\s*FOREIGN KEY[^\n]+/g, "")
    .replace(/REFERENCES \w+\(\w+\)(?: ON DELETE (?:CASCADE|SET NULL))?/g, "");
  return "CREATE TABLE " + table + " (" + body + ")";
}
for (const [repo, sourceFile, tables, extras] of [
  [
    "wannav-student-management",
    "src/db/migrate.js",
    ["students", "lessons", "lesson_reports", "tutor_weekly_snapshots"],
    "",
  ],
  [
    "extended-management",
    "server/index.js",
    [
      "student_extensions",
      "kpi_monthly_snapshots",
      "kpi_weekly_snapshots",
      "kpi_current_snapshot",
    ],
    await readFile(
      root +
        "extended-management/migrations/004_create_notion_students_cache.sql",
      "utf8",
    ),
  ],
  [
    "WannaV_EP",
    "src/models/schema.js",
    [
      "users",
      "user_progress",
      "notion_students",
      "student_profiles",
      "app_usage_daily",
      "satisfaction_surveys",
    ],
    "",
  ],
]) {
  const db = new PGlite();
  const source = await readFile(root + repo + "/" + sourceFile, "utf8");
  for (const table of tables) await db.exec(ddl(source, table));
  if (extras) await db.exec(extras);
  const catalog = require(root + repo + "/chatgpt-readonly/catalog.json");
  const { createReader } = require(
    root + repo + "/chatgpt-readonly/reader.cjs",
  );
  const reader = createReader({
    catalog,
    pool: {
      connect: async () => ({
        query: (...args) => db.query(...args),
        release() {},
      }),
    },
    token: () => "x".repeat(40),
  });
  for (const dataset of Object.keys(catalog)) {
    const result = await reader({
      method: "GET",
      authorization: "Bearer " + "x".repeat(40),
      path: "/query",
      input: { dataset },
    });
    if (result.status !== 200) {
      try {
        await db.query(catalog[dataset].sql);
      } catch (e) {
        console.log(repo, dataset, e.message);
      }
      throw new Error(
        repo + " " + dataset + " failed " + JSON.stringify(result),
      );
    }
  }
  console.log(
    repo +
      ": " +
      Object.keys(catalog).length +
      " fixed SQL queries passed against original table definitions",
  );
  await db.close();
}
const repo = "wannav-sales",
  sqlite = new DatabaseSync(":memory:");
const source = await readFile(root + repo + "/src/database.js", "utf8");
sqlite.exec(ddl(source, "sales_reports"));
sqlite.exec(
  "ALTER TABLE sales_reports ADD COLUMN parent_id INTEGER; ALTER TABLE sales_reports ADD COLUMN interview_date TEXT",
);
sqlite.exec(
  "INSERT INTO sales_reports(id,interviewer_id,interviewer_name,applicant_full_name,applicant_email,student_number,result,interview_date) VALUES(1,1,'Tutor','架空A','fixture@example.test','A','契約','2026-10-01'),(2,1,'Tutor','架空A','fixture@example.test','A','契約','2026-10-01'),(3,1,'Tutor','架空B','b@example.test','B','飛び','2026-10-01')",
);
const catalog = require(root + repo + "/chatgpt-readonly/sales-catalog.cjs"),
  { createReader } = require(root + repo + "/chatgpt-readonly/reader.cjs");
const reader = createReader({ catalog, sqlite, token: () => "x".repeat(40) });
for (const dataset of Object.keys(catalog)) {
  const result = await reader({
    method: "GET",
    authorization: "Bearer " + "x".repeat(40),
    path: "/query",
    input: {
      dataset,
      filters: [{ field: "metric_date", op: "gte", value: "2026-10-01" }],
    },
  });
  if (result.status !== 200) throw new Error(JSON.stringify(result));
  if (
    dataset === "events" &&
    (result.body.rows.length !== 2 ||
      result.body.rows.reduce((n, r) => n + r.contracts, 0) !== 1)
  )
    throw new Error("Sales duplicate count incorrect");
}
console.log(
  "wannav-sales: raw and deduplicated event SQL passed against original SQLite table; repeated contract counted once",
);
sqlite.close();
