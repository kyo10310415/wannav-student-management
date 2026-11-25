import test from "node:test";
import assert from "node:assert/strict";
import { querySchema, executeQuery } from "../src/analysis.js";
const dataset = {
  fields: {
    id: "number",
    student_id: "text",
    result: "text",
    amount: "number",
    month: "text",
    snapshot_data: "json",
  },
};
const catalog = {
  datasets: {
    "central.lesson_reports": dataset,
    "central.students": {
      fields: { student_id: "text", homeroom_tutor: "text" },
    },
  },
};
function sources(rows, right = []) {
  return {
    query: async (name) => ({
      version: 1,
      rows: name === "central.students" ? right : rows,
      truncated: false,
      history: "event",
      retrievedAt: "2026-11-16T00:00:00Z",
    }),
  };
}
test("aggregate all matching rows before pagination; preserve null and zero; distinct counts", async () => {
  const rows = [
    { student_id: "A", result: "ok", amount: null },
    { student_id: "A", result: "ok", amount: 0 },
    { student_id: "B", result: "ok", amount: "22000" },
    { student_id: "C", result: "absent", amount: null },
  ];
  const result = await executeQuery(sources(rows), catalog, {
    dataset: "central.lesson_reports",
    groupBy: ["result"],
    metrics: [
      { as: "students", op: "distinct", field: "student_id" },
      { as: "total", op: "sum", field: "amount" },
      { as: "reports", op: "count" },
    ],
    limit: 1,
  });
  assert.equal(result.rows[0].students, 2);
  assert.equal(result.rows[0].total, 22000);
  assert.equal(result.rows[0].total_known, 2);
  assert.equal(result.nextOffset, 1);
  assert.equal(result.totalMatchedRows, 4);
  const page = await executeQuery(sources(rows), catalog, {
    dataset: "central.lesson_reports",
    groupBy: ["result"],
    metrics: [{ as: "total", op: "sum", field: "amount" }],
    offset: 1,
  });
  assert.equal(page.rows[0].total, null);
});
test("saved monthly numerator/denominator ratios support 80 and 90%; zero denominator stays null", async () => {
  const rows = [
    { month: "2026-11", snapshot_data: { extended: 8, targets: 10 } },
    { month: "2026-10", snapshot_data: { extended: 9, targets: 10 } },
    { month: "2026-09", snapshot_data: { extended: 0, targets: 0 } },
  ];
  const result = await executeQuery(sources(rows), catalog, {
    dataset: "central.lesson_reports",
    groupBy: ["month"],
    metrics: [
      { as: "extended", op: "sum", field: "snapshot_data.extended" },
      { as: "targets", op: "sum", field: "snapshot_data.targets" },
    ],
    ratios: [
      { as: "extension_rate", numerator: "extended", denominator: "targets" },
    ],
  });
  assert.deepEqual(
    result.rows.map((r) => r.extension_rate),
    [80, 90, null],
  );
});
test("no aggregate from a truncated source", async () => {
  await assert.rejects(
    executeQuery(
      { query: async () => ({ rows: [], truncated: true }) },
      catalog,
      { dataset: "central.lesson_reports" },
    ),
    /partial totals/,
  );
});
test("join refuses duplicate student IDs and never joins missing IDs to each other", async () => {
  const plan = {
    dataset: "central.lesson_reports",
    join: { dataset: "central.students", fields: ["homeroom_tutor"] },
  };
  await assert.rejects(
    executeQuery(
      sources(
        [{ student_id: "A" }],
        [{ student_id: "A" }, { student_id: "A" }],
      ),
      catalog,
      plan,
    ),
    /duplicate/,
  );
  const result = await executeQuery(
    sources(
      [{ student_id: null }],
      [{ student_id: null, homeroom_tutor: "wrong" }],
    ),
    catalog,
    plan,
  );
  assert.equal(result.rows[0].student_homeroom_tutor, null);
  assert.equal(result.unmatchedJoinRows, 1);
});
test("SQL, unknown fields, write plans and prototype paths are rejected", async () => {
  assert.throws(() =>
    querySchema.parse({
      dataset: "central.students",
      sql: "DROP TABLE students",
    }),
  );
  assert.throws(() =>
    querySchema.parse({ dataset: "central.students", action: "update" }),
  );
  await assert.rejects(
    executeQuery(sources([]), catalog, {
      dataset: "central.lesson_reports",
      metrics: [{ as: "x", op: "sum", field: "password_hash" }],
    }),
    /Unknown field/,
  );
  await assert.rejects(
    executeQuery(sources([]), catalog, {
      dataset: "central.lesson_reports",
      metrics: [{ as: "x", op: "sum", field: "snapshot_data.__proto__" }],
    }),
    /Unknown field/,
  );
});

test('evaluation monthly results are queryable and join to central student metadata by student ID',async()=>{
 const datasets={'evaluation.prolevel':{fields:{student_id:'text',month:'text',overall_grade:'text'},requiresMonth:true},'central.students':{fields:{student_id:'text',homeroom_tutor:'text'}}};
 const source={query:async(name,params)=>{if(name==='evaluation.prolevel'){assert.equal(params.month,'2026-11');return {rows:[{student_id:'A',month:'2026-11',overall_grade:'B'}],truncated:false,history:'snapshot'}}return {rows:[{student_id:'A',homeroom_tutor:'fixture tutor'}],truncated:false,history:'current'}}};
 const result=await executeQuery(source,{datasets},{dataset:'evaluation.prolevel',month:'2026-11',join:{dataset:'central.students',fields:['homeroom_tutor']}});assert.equal(result.rows[0].student_homeroom_tutor,'fixture tutor');assert.equal(result.rows[0].overall_grade,'B');assert.equal(result.provenance[1].history,'current');
});
