import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { PGlite } from "@electric-sql/pglite";
import { PgStore } from "../src/store.js";
test("persistent OAuth store supports atomic consume, expiry, cleanup and a new provider instance", async () => {
  const db = new PGlite();
  try {
    await db.exec(
      await readFile(new URL("../src/schema.sql", import.meta.url), "utf8"),
    );
    const store = new PgStore(db);
    await store.put("code", "fixture", { clientId: "C" }, Date.now() + 60000);
    assert.deepEqual(await new PgStore(db).get("code", "fixture"), {
      clientId: "C",
    });
    const results = await Promise.all([
      store.take("code", "fixture"),
      store.take("code", "fixture"),
    ]);
    assert.equal(results.filter(Boolean).length, 1);
    await store.put(
      "access",
      "expired",
      { email: "fixture@example.test" },
      Date.now() - 60000,
    );
    assert.equal(await store.get("access", "expired"), undefined);
    await store.cleanup();
    assert.equal(
      (await db.query("SELECT count(*)::int AS n FROM chatgpt_oauth.records"))
        .rows[0].n,
      0,
    );
  } finally {
    await db.close();
  }
});
