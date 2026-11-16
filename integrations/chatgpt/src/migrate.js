import pg from "pg";
import { readFile } from "node:fs/promises";
if (!process.env.AUTH_DATABASE_URL)
  throw new Error("AUTH_DATABASE_URL is required");
const pool = new pg.Pool({
  connectionString: process.env.AUTH_DATABASE_URL,
  max: 1,
});
try {
  await pool.query(
    await readFile(new URL("./schema.sql", import.meta.url), "utf8"),
  );
  console.log("OAuth schema prepared");
} finally {
  await pool.end();
}
