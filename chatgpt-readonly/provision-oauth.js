import { readFile } from "node:fs/promises";
const runtimeRole = "wannav_chatgpt_oauth";
const marker = "WannaV ChatGPT OAuth runtime role";
// Only runs when an operator explicitly enables the one-time bootstrap.
export async function provisionOAuth({ pool, password, connectionString }) {
  if (typeof password !== "string" || password.length < 48)
    throw new Error("OAuth runtime password is not configured");
  const connection = new URL(connectionString),
    db = await pool.connect();
  try {
    await db.query("BEGIN");
    await db.query(
      "SELECT pg_advisory_xact_lock(hashtext('wannav_chatgpt_oauth_bootstrap'))",
    );
    const existing = (
      await db.query(
        "SELECT oid,rolsuper,rolcreaterole,rolcreatedb,shobj_description(oid,'pg_authid') AS purpose FROM pg_roles WHERE rolname=$1",
        [runtimeRole],
      )
    ).rows[0];
    if (
      existing &&
      (existing.purpose !== marker ||
        existing.rolsuper ||
        existing.rolcreaterole ||
        existing.rolcreatedb)
    )
      throw new Error("Runtime role cannot be safely reused");
    if (!existing) {
      const command = (
        await db.query(
          "SELECT format('CREATE ROLE %I LOGIN NOINHERIT NOSUPERUSER NOCREATEDB NOCREATEROLE NOREPLICATION NOBYPASSRLS CONNECTION LIMIT 3 PASSWORD %L', $1::text,$2::text) AS command",
          [runtimeRole, password],
        )
      ).rows[0].command;
      await db.query(command);
      await db.query(
        "COMMENT ON ROLE wannav_chatgpt_oauth IS 'WannaV ChatGPT OAuth runtime role'",
      );
    }
    await db.query(
      await readFile(
        new URL("../integrations/chatgpt/src/schema.sql", import.meta.url),
        "utf8",
      ),
    );
    await db.query(
      "GRANT USAGE ON SCHEMA chatgpt_oauth TO wannav_chatgpt_oauth",
    );
    await db.query(
      "GRANT SELECT,INSERT,UPDATE,DELETE ON chatgpt_oauth.records TO wannav_chatgpt_oauth",
    );
    const command = (
      await db.query(
        "SELECT format('GRANT CONNECT ON DATABASE %I TO %I',current_database(),$1::text) AS command",
        [runtimeRole],
      )
    ).rows[0].command;
    await db.query(command);
    if (
      (
        await db.query(
          "SELECT has_table_privilege($1,'public.students','SELECT') AS allowed",
          [runtimeRole],
        )
      ).rows[0].allowed
    )
      throw new Error("Unexpected business table access");
    await db.query("COMMIT");
    return {
      role: runtimeRole,
      host: connection.hostname,
      port: connection.port || "5432",
      database: decodeURIComponent(connection.pathname.slice(1)),
    };
  } catch {
    await db.query("ROLLBACK");
    throw new Error(
      "OAuth database bootstrap failed; no business data was changed",
    );
  } finally {
    db.release();
  }
}
