import { randomBytes, timingSafeEqual } from "node:crypto";
import {
  InvalidClientMetadataError,
  InvalidGrantError,
  InvalidScopeError,
  InvalidTokenError,
  InvalidTargetError,
} from "@modelcontextprotocol/sdk/server/auth/errors.js";
import { hash } from "./store.js";
const random = () => randomBytes(32).toString("base64url");
const expires = (seconds) => Date.now() + seconds * 1000;
const escape = (s) =>
  String(s).replace(
    /[&<>"']/g,
    (c) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        c
      ],
  );
const cookieName = "wannav_mcp_auth";
function browserCookie(req) {
  return String(req.headers.cookie || "")
    .split(";")
    .map((s) => s.trim())
    .find((s) => s.startsWith(cookieName + "="))
    ?.slice(cookieName.length + 1);
}
function same(a, b) {
  return (
    typeof a === "string" &&
    typeof b === "string" &&
    a.length === b.length &&
    timingSafeEqual(Buffer.from(a), Buffer.from(b))
  );
}
export class GoogleOAuthProvider {
  constructor({
    store,
    google,
    origin,
    redirectUris,
    googleClientId,
    domain = "oneloopinc.net",
  }) {
    Object.assign(this, {
      store,
      google,
      origin,
      redirectUris,
      googleClientId,
      domain,
    });
    this.resource = new URL("/mcp", origin).href;
    this.clientsStore = {
      getClient: (id) => store.get("client", id),
      registerClient: (client) => this.register(client),
    };
  }
  allowedEmail(email) {
    return (
      typeof email === "string" &&
      email.toLowerCase().endsWith("@" + this.domain)
    );
  }
  resourceCheck(resource) {
    if (resource && resource.href !== this.resource)
      throw new InvalidTargetError("Invalid resource");
  }
  scopeCheck(scopes) {
    if (scopes?.some((s) => s !== "read"))
      throw new InvalidScopeError("Only read is supported");
  }
  async register(client) {
    if (
      !client.redirect_uris?.length ||
      client.redirect_uris.length > 5 ||
      client.redirect_uris.some((u) => !this.redirectUris.includes(u))
    )
      throw new InvalidClientMetadataError("Redirect URI is not approved");
    if (
      client.grant_types?.some(
        (x) => !["authorization_code", "refresh_token"].includes(x),
      ) ||
      client.response_types?.some((x) => x !== "code")
    )
      throw new InvalidClientMetadataError("Unsupported grant");
    if (client.scope && client.scope !== "read")
      throw new InvalidClientMetadataError("Only read is supported");
    const record = {
      ...client,
      client_id: random(),
      client_id_issued_at: Math.floor(Date.now() / 1000),
      grant_types: ["authorization_code", "refresh_token"],
      response_types: ["code"],
      scope: "read",
    };
    await this.store.put(
      "client",
      record.client_id,
      record,
      expires(365 * 86400),
    );
    return record;
  }
  async authorize(client, params, res) {
    this.scopeCheck(params.scopes);
    this.resourceCheck(params.resource);
    if (!/^[A-Za-z0-9_-]{43}$/.test(params.codeChallenge))
      throw new InvalidGrantError("S256 PKCE required");
    const state = random(),
      binding = random(),
      nonce = random();
    await this.store.put(
      "pending",
      hash(state),
      {
        clientId: client.client_id,
        clientName: client.client_name || "ChatGPT",
        redirectUri: params.redirectUri,
        state: params.state,
        challenge: params.codeChallenge,
        binding: hash(binding),
        nonce,
      },
      expires(600),
    );
    res.cookie(cookieName, binding, {
      httpOnly: true,
      secure: this.origin.startsWith("https:"),
      sameSite: "lax",
      path: "/oauth",
      maxAge: 600000,
    });
    res.redirect(
      this.google.generateAuthUrl({
        scope: ["openid", "email"],
        state,
        nonce,
        hd: this.domain,
        prompt: "select_account",
      }),
    );
  }
  async callback(req, res) {
    const state = req.query.state,
      code = req.query.code;
    if (typeof state !== "string" || typeof code !== "string")
      return res.status(400).send("認証をやり直してください。");
    const pending = await this.store.get("pending", hash(state));
    if (!pending || !same(pending.binding, hash(browserCookie(req) || "")))
      return res.status(400).send("認証をやり直してください。");
    if (!(await this.store.take("pending", hash(state))))
      return res.status(400).send("認証をやり直してください。");
    const { tokens } = await this.google.getToken(code);
    const ticket = await this.google.verifyIdToken({
      idToken: tokens.id_token,
      audience: this.googleClientId,
    });
    const user = ticket.getPayload();
    if (
      !user?.email_verified ||
      user.hd !== this.domain ||
      !this.allowedEmail(user.email) ||
      user.nonce !== pending.nonce
    )
      return res.status(403).send("社内Googleアカウントが必要です。");
    const consent = random();
    await this.store.put(
      "consent",
      hash(consent),
      { ...pending, email: user.email.toLowerCase() },
      expires(300),
    );
    res
      // Chrome sends Origin:null on form POST when this page uses no-referrer.
      // strict-origin keeps CSRF checks without disclosing callback query values.
      .set("Referrer-Policy", "strict-origin")
      .set(
        "Content-Security-Policy",
        `default-src 'none'; form-action 'self' ${new URL(pending.redirectUri).origin}; base-uri 'none'; frame-ancestors 'none'`,
      )
      .type("html")
      .send(
        `<!doctype html><html lang="ja"><meta charset="utf-8"><title>WannaV 分析接続</title><h1>WannaV 分析接続</h1><p>${escape(user.email)} として ${escape(pending.clientName)} に、中央管理・延長管理・EP・売上・支払い管理の閲覧・検索・分析を許可します。</p><p>社内共通の閲覧範囲です。生徒名や個別記録を含みます。更新・通知はできません。</p><form method="post" action="/oauth/consent"><input type="hidden" name="consent" value="${consent}"><button name="decision" value="allow">読み取りを許可</button><button name="decision" value="deny">キャンセル</button></form></html>`,
      );
  }
  async consent(req, res) {
    if (
      req.get("origin") !== this.origin ||
      typeof req.body.consent !== "string"
    )
      return res.sendStatus(403);
    const key = hash(req.body.consent),
      pending = await this.store.get("consent", key);
    if (!pending || !same(pending.binding, hash(browserCookie(req) || "")))
      return res.sendStatus(403);
    if (!(await this.store.take("consent", key))) return res.sendStatus(400);
    res.clearCookie(cookieName, {
      path: "/oauth",
      httpOnly: true,
      secure: this.origin.startsWith("https:"),
      sameSite: "lax",
    });
    const target = new URL(pending.redirectUri);
    if (pending.state) target.searchParams.set("state", pending.state);
    if (req.body.decision !== "allow")
      target.searchParams.set("error", "access_denied");
    else {
      const code = random();
      await this.store.put("code", hash(code), pending, expires(120));
      target.searchParams.set("code", code);
    }
    return res.redirect(target.href);
  }
  async challengeForAuthorizationCode(client, code) {
    const record = await this.store.get("code", hash(code));
    if (!record || record.clientId !== client.client_id)
      throw new InvalidGrantError("Invalid authorization code");
    return record.challenge;
  }
  async exchangeAuthorizationCode(
    client,
    code,
    _verifier,
    redirectUri,
    resource,
  ) {
    this.resourceCheck(resource);
    const key = hash(code),
      record = await this.store.get("code", key);
    if (
      !record ||
      record.clientId !== client.client_id ||
      redirectUri !== record.redirectUri
    )
      throw new InvalidGrantError("Invalid authorization code");
    if (!(await this.store.take("code", key)))
      throw new InvalidGrantError("Code already used");
    const grantId = random(),
      grant = {
        clientId: client.client_id,
        email: record.email,
        expiresAt: expires(30 * 86400),
      };
    await this.store.put("grant", grantId, grant, grant.expiresAt);
    return this.issue(grantId, grant);
  }
  async issue(grantId, grant) {
    const access = random(),
      refresh = random(),
      record = { grantId, clientId: grant.clientId, email: grant.email };
    await this.store.put(
      "access",
      hash(access),
      { ...record, expiresAt: Math.floor(Date.now() / 1000) + 3600 },
      expires(3600),
    );
    await this.store.put("refresh", hash(refresh), record, grant.expiresAt);
    return {
      access_token: access,
      refresh_token: refresh,
      token_type: "Bearer",
      expires_in: 3600,
      scope: "read",
    };
  }
  async exchangeRefreshToken(client, token, scopes, resource) {
    this.scopeCheck(scopes);
    this.resourceCheck(resource);
    const key = hash(token),
      record = await this.store.get("refresh", key);
    if (!record || record.clientId !== client.client_id)
      throw new InvalidGrantError("Invalid refresh token");
    const grant = await this.store.get("grant", record.grantId);
    if (!grant || !this.allowedEmail(grant.email))
      throw new InvalidGrantError("Grant expired or revoked");
    if (!(await this.store.take("refresh", key)))
      throw new InvalidGrantError("Refresh token already used");
    return this.issue(record.grantId, grant);
  }
  async verifyAccessToken(token) {
    const record = await this.store.get("access", hash(token));
    const grant = record && (await this.store.get("grant", record.grantId));
    if (!grant || !this.allowedEmail(grant.email))
      throw new InvalidTokenError("Invalid or revoked token");
    return {
      token,
      clientId: record.clientId,
      expiresAt: record.expiresAt,
      scopes: ["read"],
      resource: this.resource,
      extra: { email: grant.email },
    };
  }
  async revokeToken(client, { token }) {
    for (const kind of ["access", "refresh"]) {
      const record = await this.store.get(kind, hash(token));
      if (record?.clientId === client.client_id)
        await this.store.delete("grant", record.grantId);
    }
  }
}
