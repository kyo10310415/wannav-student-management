import test from "node:test";
import { createServer } from "node:http";
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { GoogleOAuthProvider } from "../src/oauth.js";
import { createApp } from "../src/app.js";
import { hash } from "../src/store.js";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
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
async function setup(t) {
  const store = new Store();
  let googleNonce;
  const google = {
    generateAuthUrl: (params) => {
      googleNonce = params.nonce;
      return "https://accounts.google.com/o/oauth2/auth?state=" + params.state;
    },
    getToken: async () => ({ tokens: { id_token: "google-token" } }),
    verifyIdToken: async () => ({
      getPayload: () => ({
        email: "fixture@oneloopinc.net",
        email_verified: true,
        hd: "oneloopinc.net",
        nonce: googleNonce,
      }),
    }),
  };
  const provider = new GoogleOAuthProvider({
    store,
    google,
    origin: "http://127.0.0.1",
    googleClientId: "test-client",
    redirectUris: ["https://chatgpt.example/callback"],
  });
  const sources = {
    catalog: async () => ({
      datasets: {
        "central.students": {
          title: "中央管理 生徒",
          source: "central",
          dataset: "students",
          fields: { student_id: "text", name: "text" },
          history: "current",
        },
      },
      unavailable: ["ep"],
    }),
    query: async () => ({
      version: 1,
      dataset: "students",
      rows: [{ student_id: "FIXTURE1", name: "架空の生徒" }],
      history: "current",
      retrievedAt: new Date().toISOString(),
      truncated: false,
    }),
  };
  const server = createServer();
  server.listen(0, "127.0.0.1");
  await new Promise((r) => server.once("listening", r));
  const origin = "http://127.0.0.1:" + server.address().port;
  provider.origin = origin;
  provider.resource = origin + "/mcp";
  server.on(
    "request",
    createApp({ provider, sources, origin, production: false }),
  );
  t.after(() => new Promise((r) => server.close(r)));
  return { provider, store, origin };
}
test("real HTTP OAuth, S256 PKCE, consent, MCP SDK discovery/search/fetch; writes not exposed", async (t) => {
  const { provider, origin } = await setup(t);
  const metadata = await fetch(
    origin + "/.well-known/oauth-authorization-server",
  ).then((r) => r.json());
  assert.ok(metadata.authorization_endpoint);
  assert.equal(metadata.authorization_response_iss_parameter_supported, true);
  assert.ok(metadata.registration_endpoint);
  const register = await fetch(origin + "/register", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      redirect_uris: ["https://chatgpt.example/callback"],
      token_endpoint_auth_method: "none",
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      client_name: "ChatGPT Test",
    }),
  });
  assert.equal(register.status, 201);
  const client = await register.json();
  const verifier = "a".repeat(64),
    challenge = createHash("sha256").update(verifier).digest("base64url");
  const authorize = await fetch(
    origin +
      "/authorize?" +
      new URLSearchParams({
        client_id: client.client_id,
        redirect_uri: "https://chatgpt.example/callback",
        response_type: "code",
        scope: "read",
        state: "chatgpt-state",
        code_challenge: challenge,
        code_challenge_method: "S256",
        resource: provider.resource,
      }),
    { redirect: "manual" },
  );
  assert.equal(authorize.status, 302);
  const cookie = authorize.headers.get("set-cookie").split(";")[0],
    googleState = new URL(authorize.headers.get("location")).searchParams.get(
      "state",
    );
  const denied = await fetch(
    origin + "/oauth/google/callback?state=" + googleState + "&code=code",
  );
  assert.equal(denied.status, 400);
  const callback = await fetch(
    origin + "/oauth/google/callback?state=" + googleState + "&code=code",
    { headers: { Cookie: cookie } },
  );
  assert.equal(callback.status, 200);
  assert.equal(callback.headers.get("referrer-policy"), "strict-origin");
  const page = await callback.text();
  assert.ok(page.includes("更新・通知はできません"));
  const consent = /name="consent" value="([^"]+)"/.exec(page)[1];
  const accepted = await fetch(origin + "/oauth/consent", {
    method: "POST",
    headers: {
      Cookie: cookie,
      Origin: origin,
      "Content-Type": "application/x-www-form-urlencoded",
    },
    body: new URLSearchParams({ consent, decision: "allow" }),
    redirect: "manual",
  });
  assert.equal(accepted.status, 302);
  const target = new URL(accepted.headers.get("location"));
  assert.equal(target.searchParams.get("state"), "chatgpt-state");
  assert.equal(target.searchParams.get("iss"), metadata.issuer);
  const rejected = await fetch(
    origin +
      "/authorize?" +
      new URLSearchParams({
        client_id: client.client_id,
        redirect_uri: "https://chatgpt.example/callback",
        response_type: "code",
        scope: "write",
        code_challenge: challenge,
        code_challenge_method: "S256",
      }),
    { redirect: "manual" },
  );
  assert.equal(
    new URL(rejected.headers.get("location")).searchParams.get("iss"),
    metadata.issuer,
  );
  const tokenBody = {
    client_id: client.client_id,
    grant_type: "authorization_code",
    code: target.searchParams.get("code"),
    redirect_uri: "https://chatgpt.example/callback",
    resource: provider.resource,
  };
  const wrong = await fetch(origin + "/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...tokenBody, code_verifier: "wrong" }),
  });
  assert.equal(wrong.status, 400);
  const tokenResponse = await fetch(origin + "/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ ...tokenBody, code_verifier: verifier }),
  });
  assert.equal(tokenResponse.status, 200);
  const tokens = await tokenResponse.json();
  const sdk = new Client({ name: "fixture", version: "1.0" });
  t.after(() => sdk.close());
  await sdk.connect(
    new StreamableHTTPClientTransport(new URL(origin + "/mcp"), {
      requestInit: {
        headers: { Authorization: "Bearer " + tokens.access_token },
      },
    }),
  );
  const list = await sdk.listTools();
  assert.deepEqual(
    list.tools.map((t) => t.name),
    ["search", "fetch"],
  );
  assert.ok(list.tools.every((t) => t.annotations.readOnlyHint));
  const catalog = await sdk.callTool({
    name: "fetch",
    arguments: { id: "catalog" },
  });
  assert.ok(catalog.content[0].text.includes("unavailable"));
  const search = await sdk.callTool({
    name: "search",
    arguments: { query: JSON.stringify({ dataset: "central.students" }) },
  });
  const id = JSON.parse(search.content[0].text).results[0].id;
  const result = await sdk.callTool({ name: "fetch", arguments: { id } });
  assert.ok(result.content[0].text.includes("FIXTURE1"));
  await provider.revokeToken(client, { token: tokens.refresh_token });
  assert.equal(
    (
      await fetch(origin + "/mcp", {
        method: "POST",
        headers: {
          Authorization: "Bearer " + tokens.access_token,
          "Content-Type": "application/json",
        },
        body: "{}",
      })
    ).status,
    401,
  );
});
test("MCP cannot be accessed anonymously and metadata does not contain student data", async (t) => {
  const { origin } = await setup(t);
  const response = await fetch(origin + "/mcp", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: "{}",
  });
  assert.equal(response.status, 401);
  assert.ok(
    response.headers.get("www-authenticate").includes("resource_metadata"),
  );
  assert.equal(
    (await fetch(origin + "/reference").then((r) => r.text())).includes(
      "FIXTURE1",
    ),
    false,
  );
});
