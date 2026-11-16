const test = require("node:test");
const assert = require("node:assert/strict");
test("central satisfaction keeps missing scores null, preserves zero and normalizes month without writing sheets", async () => {
  const { createCatalog } = await import("./central-catalog.js");
  let called;
  const catalog = createCatalog(
    async (sheet) => {
      called = sheet;
      return [
        {
          student_id: "A",
          year_month: "2026/9",
          satisfaction_score: "",
          empathy_score: "0",
          advice_score: "invalid",
          reason: "架空回答",
        },
        { student_id: "B", year_month: "2026/11", satisfaction_score: "9.5" },
      ];
    },
    { GOOGLE_CACHE_SHEET_ID: "fixture-sheet" },
  );
  const rows = await catalog.satisfaction.load();
  assert.equal(called, "fixture-sheet");
  assert.equal(rows[0].year_month, "2026-09");
  assert.equal(rows[0].satisfaction_score, null);
  assert.equal(rows[0].empathy_score, 0);
  assert.equal(rows[0].advice_score, null);
  assert.equal(rows[1].satisfaction_score, 9.5);
  await assert.rejects(
    createCatalog(async () => [], {}).satisfaction.load(),
    /not configured/,
  );
});
