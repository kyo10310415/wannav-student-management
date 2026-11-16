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

test("large Sheets data is filtered before normalizing unrelated values; matching overflow is explicit", async () => {
  const { createCatalog } = await import("./central-catalog.js");
  let touched = 0;
  const irrelevant = {
    student_id: "other",
    get satisfaction_score() {
      touched++;
      return "8";
    },
  };
  const data = [
    ...Array(12000).fill(irrelevant),
    { student_id: "target", year_month: "2026/9", satisfaction_score: "9" },
  ];
  const cat = createCatalog(async () => data, { GOOGLE_SHEET_ID: "fixture" });
  const rows = await cat.satisfaction.load(null, {
    filters: [
      { field: "student_id", op: "eq", value: "target" },
      { field: "year_month", op: "eq", value: "2026-09" },
    ],
  });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].satisfaction_score, 9);
  assert.equal(touched, 0);
  assert.equal((await cat.satisfaction.load(null, {})).length, 10001);
});

test("concurrent Sheets reads share one bounded upstream request and a failure can retry", async () => {
  const { createCatalog } = await import("./central-catalog.js");
  let calls = 0,
    release,
    options;
  const pending = new Promise((resolve) => (release = resolve));
  const cat = createCatalog(
    async (_sheet, opts) => {
      calls++;
      options = opts;
      await pending;
      return [{ student_id: "A" }];
    },
    { GOOGLE_SHEET_ID: "fixture" },
  );
  const first = cat.satisfaction.load(),
    second = cat.satisfaction.load();
  release();
  await Promise.all([first, second]);
  assert.equal(calls, 1);
  assert.deepEqual(options, { timeout: 30000, retry: false });
  let failures = 0;
  const failing = createCatalog(
    async () => {
      if (!failures++) throw new Error("synthetic");
      return [];
    },
    { GOOGLE_SHEET_ID: "fixture" },
  );
  await assert.rejects(failing.satisfaction.load());
  assert.deepEqual(await failing.satisfaction.load(), []);
});
