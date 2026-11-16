import test from "node:test";
import assert from "node:assert/strict";
import { GoogleOAuthProvider } from "../src/oauth.js";
import { hash } from "../src/store.js";
export class MemoryStore {
  records = new Map();
  async put(kind, key, data, expiry) {
    this.records.set(kind + ":" + key, { data, expiry });
  }
  async get(kind, key) {
    const row = this.records.get(kind + ":" + key);
    return row?.expiry > Date.now() ? row.data : undefined;
  }
  async take(kind, key) {
    const data = await this.get(kind, key);
    if (!this.records.delete(kind + ":" + key)) return;
    return data;
  }
  async delete(kind, key) {
    this.records.delete(kind + ":" + key);
  }
}
function fixture() {
  const store = new MemoryStore(),
    provider = new GoogleOAuthProvider({
      store,
      google: {},
      origin: "https://mcp.example",
      redirectUris: ["https://chatgpt.example/callback"],
    });
  return { store, provider };
}
test("client registration requires approved exact redirect and read scope", async () => {
  const { provider } = fixture();
  await assert.rejects(
    provider.register({ redirect_uris: ["https://evil.example/callback"] }),
  );
  await assert.rejects(
    provider.register({
      redirect_uris: ["https://chatgpt.example/callback"],
      scope: "write",
    }),
  );
  const client = await provider.register({
    redirect_uris: ["https://chatgpt.example/callback"],
    token_endpoint_auth_method: "none",
  });
  assert.equal(
    (await provider.clientsStore.getClient(client.client_id)).scope,
    "read",
  );
});
test("authorization code binds client, redirect, resource and consumes once", async () => {
  const { provider, store } = fixture(),
    client = { client_id: "C" };
  await store.put(
    "code",
    hash("code"),
    {
      clientId: "C",
      redirectUri: "https://chatgpt.example/callback",
      email: "a@oneloopinc.net",
      challenge: "challenge",
    },
    Date.now() + 10000,
  );
  assert.equal(
    await provider.challengeForAuthorizationCode(client, "code"),
    "challenge",
  );
  await assert.rejects(
    provider.exchangeAuthorizationCode(
      client,
      "code",
      null,
      "https://evil.example/callback",
    ),
  );
  await assert.rejects(
    provider.exchangeAuthorizationCode(
      client,
      "code",
      null,
      "https://chatgpt.example/callback",
      new URL("https://evil.example/mcp"),
    ),
  );
  const tokens = await provider.exchangeAuthorizationCode(
    client,
    "code",
    null,
    "https://chatgpt.example/callback",
  );
  assert.equal(
    (await provider.verifyAccessToken(tokens.access_token)).resource,
    "https://mcp.example/mcp",
  );
  await assert.rejects(
    provider.exchangeAuthorizationCode(
      client,
      "code",
      null,
      "https://chatgpt.example/callback",
    ),
  );
});
test("refresh rotates, cannot increase scope, survives new provider and revokes the grant", async () => {
  const { provider, store } = fixture(),
    grant = {
      clientId: "C",
      email: "a@oneloopinc.net",
      expiresAt: Date.now() + 100000,
    };
  await store.put("grant", "G", grant, grant.expiresAt);
  const tokens = await provider.issue("G", grant);
  await assert.rejects(
    provider.exchangeRefreshToken({ client_id: "C" }, tokens.refresh_token, [
      "write",
    ]),
  );
  const next = await provider.exchangeRefreshToken(
    { client_id: "C" },
    tokens.refresh_token,
    ["read"],
  );
  await assert.rejects(
    provider.exchangeRefreshToken({ client_id: "C" }, tokens.refresh_token),
  );
  const restarted = new GoogleOAuthProvider({
    store,
    google: {},
    origin: "https://mcp.example",
    redirectUris: [],
  });
  assert.equal(
    (await restarted.verifyAccessToken(next.access_token)).extra.email,
    grant.email,
  );
  await restarted.revokeToken(
    { client_id: "C" },
    { token: next.refresh_token },
  );
  await assert.rejects(provider.verifyAccessToken(next.access_token));
  await assert.rejects(provider.verifyAccessToken(tokens.access_token));
});
test("domain suffix lookalikes and missing accounts are rejected", () => {
  const { provider } = fixture();
  assert.equal(provider.allowedEmail("a@oneloopinc.net.evil.test"), false);
  assert.equal(provider.allowedEmail("a@eviloneloopinc.net"), false);
  assert.equal(provider.allowedEmail("a@oneloopinc.net"), true);
});
