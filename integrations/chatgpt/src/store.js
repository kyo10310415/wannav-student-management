import { createHash } from "node:crypto";
export const hash = (value) => createHash("sha256").update(value).digest("hex");
export class PgStore {
  constructor(pool) {
    this.pool = pool;
  }
  async get(kind, key) {
    return (
      await this.pool.query(
        "SELECT data FROM chatgpt_oauth.records WHERE kind=$1 AND key=$2 AND expires_at>now()",
        [kind, key],
      )
    ).rows[0]?.data;
  }
  async put(kind, key, data, expiresAt) {
    await this.pool.query(
      "INSERT INTO chatgpt_oauth.records(kind,key,data,expires_at) VALUES($1,$2,$3,$4) ON CONFLICT(kind,key) DO UPDATE SET data=EXCLUDED.data,expires_at=EXCLUDED.expires_at",
      [kind, key, JSON.stringify(data), new Date(expiresAt)],
    );
  }
  async take(kind, key) {
    return (
      await this.pool.query(
        "DELETE FROM chatgpt_oauth.records WHERE kind=$1 AND key=$2 AND expires_at>now() RETURNING data",
        [kind, key],
      )
    ).rows[0]?.data;
  }
  async delete(kind, key) {
    await this.pool.query(
      "DELETE FROM chatgpt_oauth.records WHERE kind=$1 AND key=$2",
      [kind, key],
    );
  }
  async cleanup() {
    await this.pool.query(
      "DELETE FROM chatgpt_oauth.records WHERE expires_at<=now()",
    );
  }
}
