import test from "node:test";
import assert from "node:assert/strict";
import { createServer } from "node:http";
import { createHash } from "node:crypto";
import { chromium } from "playwright";
import { createApp } from "../src/app.js";
import { GoogleOAuthProvider } from "../src/oauth.js";
class Store {
  data = new Map();
  async put(k, id, data, expires) {
    this.data.set(k + id, { data, expires });
  }
  async get(k, id) {
    const r = this.data.get(k + id);
    return r?.expires > Date.now() ? r.data : undefined;
  }
  async take(k, id) {
    const data = await this.get(k, id);
    return this.data.delete(k + id) ? data : undefined;
  }
  async delete(k, id) {
    this.data.delete(k + id);
  }
}
async function fixture(t) {
  const store = new Store();
  let nonce;
  const google = {
    generateAuthUrl: (params) => {
      nonce = params.nonce;
      return "https://accounts.google.com/o/oauth2/auth?state=" + params.state;
    },
    getToken: async () => ({ tokens: { id_token: "fixture-google-token" } }),
    verifyIdToken: async () => ({
      getPayload: () => ({
        email: "fixture@oneloopinc.net",
        email_verified: true,
        hd: "oneloopinc.net",
        nonce,
      }),
    }),
  };
  const server = createServer();
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  const origin = "http://127.0.0.1:" + server.address().port;
  const callbackServer = createServer((req, res) => {
    const url = new URL(req.url, "http://fixture");
    res.end(
      url.searchParams.get("code")
        ? "CONNECTED"
        : url.searchParams.get("error") || "MISSING_CODE",
    );
  });
  await new Promise((r) => callbackServer.listen(0, "127.0.0.1", r));
  const callback =
    "http://127.0.0.1:" +
    callbackServer.address().port +
    "/fixture-chatgpt-callback";
  const provider = new GoogleOAuthProvider({
    store,
    google,
    origin,
    googleClientId: "fixture-google-client",
    redirectUris: [callback],
  });
  const app = createApp({ provider, sources: {}, origin, production: false });
  server.on("request", app);
  const browser = await chromium.launch({
    ...(process.env.CHROMIUM_PATH
      ? { executablePath: process.env.CHROMIUM_PATH }
      : {}),
    headless: true,
    args: ["--no-sandbox"],
  });
  t.after(async () => {
    await browser.close();
    await new Promise((r) => server.close(r));
    await new Promise((r) => callbackServer.close(r));
  });
  const client = await provider.register({
    redirect_uris: [callback],
    client_name: "Fixture ChatGPT",
    token_endpoint_auth_method: "none",
  });
  const verifier = "v".repeat(64),
    challenge = createHash("sha256").update(verifier).digest("base64url");
  const auth =
    origin +
    "/authorize?" +
    new URLSearchParams({
      client_id: client.client_id,
      redirect_uri: callback,
      response_type: "code",
      scope: "read",
      state: "fixture-state",
      code_challenge: challenge,
      code_challenge_method: "S256",
    });
  const page = await browser.newPage();
  let postedOrigin, postedReferer;
  page.on("request", (request) => {
    if (
      request.method() === "POST" &&
      request.url() === origin + "/oauth/consent"
    ) {
      postedOrigin = request.headers()["origin"];
      postedReferer = request.headers()["referer"];
    }
  });
  // Mock Google's response through the real callback handler; the page and form
  // submission themselves run in Chromium with its actual Origin/referrer rules.
  const authorize = await fetch(auth, { redirect: "manual" });
  assert.equal(authorize.status, 302);
  const binding = authorize.headers
    .get("set-cookie")
    .split(";")[0]
    .split("=")[1];
  await page
    .context()
    .addCookies([
      {
        name: "wannav_mcp_auth",
        value: binding,
        domain: "127.0.0.1",
        path: "/oauth",
        httpOnly: true,
        secure: false,
        sameSite: "Lax",
      },
    ]);
  const state = new URL(authorize.headers.get("location")).searchParams.get(
    "state",
  );
  page.setDefaultTimeout(10000);
  await page.goto(
    origin +
      "/oauth/google/callback?" +
      new URLSearchParams({ state, code: "fixture-google-code" }),
  );
  await page.getByRole("button", { name: "読み取りを許可" }).waitFor();

  return {
    page,
    origin,
    provider,
    client,
    verifier,
    callback,
    posted: () => ({ origin: postedOrigin, referer: postedReferer }),
  };
}
test("Chrome submits real consent form with origin and bound cookie; OAuth exchange completes", async (t) => {
  const f = await fixture(t);
  await Promise.all([
    f.page.waitForURL("**/fixture-chatgpt-callback?**"),
    f.page.getByRole("button", { name: "読み取りを許可" }).click(),
  ]);
  assert.equal(await f.page.locator("body").innerText(), "CONNECTED");
  assert.equal(f.posted().origin, f.origin);
  assert.equal(f.posted().referer, f.origin + "/");
  const target = new URL(f.page.url());
  assert.equal(target.origin, new URL(f.callback).origin);
  assert.equal(target.searchParams.get("state"), "fixture-state");
  assert.equal(target.searchParams.get("iss"), f.origin + "/");
  const res = await fetch(f.origin + "/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      client_id: f.client.client_id,
      grant_type: "authorization_code",
      code: target.searchParams.get("code"),
      code_verifier: f.verifier,
      redirect_uri: f.callback,
      resource: f.origin + "/mcp",
    }),
  });
  assert.equal(res.status, 200);
  const tokens = await res.json();
  assert.equal(
    (await f.provider.verifyAccessToken(tokens.access_token)).extra.email,
    "fixture@oneloopinc.net",
  );
});
test("missing binding cookie still rejects the real browser form", async (t) => {
  const f = await fixture(t);
  await f.page.context().clearCookies();
  const responsePromise = f.page.waitForResponse(
    (r) =>
      r.url() === f.origin + "/oauth/consent" &&
      r.request().method() === "POST",
  );
  await f.page.getByRole("button", { name: "読み取りを許可" }).click();
  assert.equal((await responsePromise).status(), 403);
});
test("null or foreign Origin is still rejected with the correct browser cookie and consent token", async (t) => {
  const f = await fixture(t),
    consent = await f.page.locator("input[name=consent]").inputValue();
  const cookie = (await f.page.context().cookies())
    .map((c) => c.name + "=" + c.value)
    .join("; ");
  for (const origin of ["null", "https://foreign.example"]) {
    const res = await fetch(f.origin + "/oauth/consent", {
      method: "POST",
      headers: {
        Origin: origin,
        Cookie: cookie,
        "Content-Type": "application/x-www-form-urlencoded",
      },
      body: new URLSearchParams({ consent, decision: "allow" }),
      redirect: "manual",
    });
    assert.equal(res.status, 403);
  }
});
