import test from "node:test";
import assert from "node:assert/strict";
import { PGlite } from "@electric-sql/pglite";
import { provisionOAuth } from "../../../chatgpt-readonly/provision-oauth.js";
import { createSetupApp } from "../src/setup.js";
test("explicit bootstrap grants only OAuth table access, is idempotent and does not expose the password", async () => {
  const db = new PGlite();
  try {
    await db.exec("CREATE TABLE public.students(student_id text)");
    const pool = {
      connect: async () => ({
        query: async (sql, ...args) => {
          try {
            return sql.includes("CREATE SCHEMA IF NOT EXISTS")
              ? await db.exec(sql)
              : await db.query(sql, ...args);
          } catch (e) {
            throw e;
          }
        },
        release() {},
      }),
    };
    const args = {
      pool,
      password: "fixture-private-password-".repeat(3),
      connectionString: "postgres://db.internal:5432/fixture",
    };
    const metadata = await provisionOAuth(args);
    assert.deepEqual(metadata, {
      role: "wannav_chatgpt_oauth",
      host: "db.internal",
      port: "5432",
      database: "fixture",
    });
    assert.equal(JSON.stringify(metadata).includes("password"), false);
    await provisionOAuth(args);
    assert.equal(
      (
        await db.query(
          "SELECT has_table_privilege('wannav_chatgpt_oauth','chatgpt_oauth.records','INSERT') AS allowed",
        )
      ).rows[0].allowed,
      true,
    );
    assert.equal(
      (
        await db.query(
          "SELECT has_table_privilege('wannav_chatgpt_oauth','public.students','SELECT') AS allowed",
        )
      ).rows[0].allowed,
      false,
    );
  } finally {
    await db.close();
  }
});
test("bootstrap refuses an unrelated pre-existing role and rolls back", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      "CREATE ROLE wannav_chatgpt_oauth; CREATE TABLE public.students(student_id text)",
    );
    const pool = {
      connect: async () => ({
        query: async (sql, ...args) => {
          try {
            return sql.includes("CREATE SCHEMA IF NOT EXISTS")
              ? await db.exec(sql)
              : await db.query(sql, ...args);
          } catch (e) {
            throw e;
          }
        },
        release() {},
      }),
    };
    await assert.rejects(
      provisionOAuth({
        pool,
        password: "fixture-password-".repeat(4),
        connectionString: "postgres://db.internal/fixture",
      }),
      /bootstrap failed/,
    );
    assert.equal(
      (
        await db.query(
          "SELECT to_regclass('chatgpt_oauth.records') AS table_name",
        )
      ).rows[0].table_name,
      null,
    );
  } finally {
    await db.close();
  }
});
test("setup mode explicitly disables MCP, OAuth and all data endpoints", async (t) => {
  const server = createSetupApp().listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  t.after(() => new Promise((r) => server.close(r)));
  const origin = "http://127.0.0.1:" + server.address().port;
  const health = await fetch(origin + "/health").then((r) => r.json());
  assert.equal(health.dataAccessEnabled, false);
  for (const path of [
    "/mcp",
    "/authorize",
    "/.well-known/oauth-authorization-server",
    "/integrations/chatgpt/v1/catalog",
  ])
    assert.equal((await fetch(origin + path)).status, 503);
});
