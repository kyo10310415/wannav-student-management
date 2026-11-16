import pg from "pg";
import { OAuth2Client } from "google-auth-library";
import { PgStore } from "./store.js";
import { GoogleOAuthProvider } from "./oauth.js";
import { Sources, sourceConfiguration } from "./sources.js";
import { createApp } from "./app.js";
const env = process.env;
for (const key of [
  "PUBLIC_URL",
  "AUTH_DATABASE_URL",
  "GOOGLE_CLIENT_ID",
  "GOOGLE_CLIENT_SECRET",
  "CHATGPT_REDIRECT_URIS",
])
  if (!env[key]) throw new Error(key + " is required");
const url = new URL(env.PUBLIC_URL);
if (
  url.protocol !== "https:" ||
  url.username ||
  url.password ||
  url.pathname !== "/" ||
  url.search ||
  url.hash
)
  throw new Error("PUBLIC_URL must be an HTTPS origin");
const origin = url.origin,
  redirectUris = env.CHATGPT_REDIRECT_URIS.split(",")
    .map((x) => x.trim())
    .filter(Boolean);
for (const raw of redirectUris) {
  const u = new URL(raw);
  if (u.protocol !== "https:" || u.username || u.password || u.hash)
    throw new Error("Approved OAuth redirect URIs must use HTTPS");
}
const pool = new pg.Pool({
  connectionString: env.AUTH_DATABASE_URL,
  max: 3,
  connectionTimeoutMillis: 5000,
  statement_timeout: 10000,
});
pool.on("error", () => console.error("OAuth database connection failed"));
const store = new PgStore(pool);
await pool.query("SELECT 1 FROM chatgpt_oauth.records LIMIT 0");
const google = new OAuth2Client(
  env.GOOGLE_CLIENT_ID,
  env.GOOGLE_CLIENT_SECRET,
  origin + "/oauth/google/callback",
);
const provider = new GoogleOAuthProvider({
  store,
  google,
  origin,
  redirectUris,
  googleClientId: env.GOOGLE_CLIENT_ID,
});
const app = createApp({
  provider,
  sources: new Sources(sourceConfiguration(env)),
  origin,
});
const http = app.listen(Number(env.PORT || 3000), "0.0.0.0", () =>
  console.log("WannaV read-only MCP started"),
);
const cleanup = setInterval(
  () => store.cleanup().catch(() => console.error("OAuth cleanup failed")),
  3600000,
);
cleanup.unref();
for (const signal of ["SIGTERM", "SIGINT"])
  process.once(signal, () => {
    clearInterval(cleanup);
    http.close(() => pool.end());
    setTimeout(() => process.exit(1), 25000).unref();
  });
