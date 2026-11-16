import express from "express";
import { rateLimit } from "express-rate-limit";
import {
  mcpAuthRouter,
  getOAuthProtectedResourceMetadataUrl,
} from "@modelcontextprotocol/sdk/server/auth/router.js";
import { requireBearerAuth } from "@modelcontextprotocol/sdk/server/auth/middleware/bearerAuth.js";
import { StreamableHTTPServerTransport } from "@modelcontextprotocol/sdk/server/streamableHttp.js";
import { createMcpServer } from "./tools.js";
export function createApp({ provider, sources, origin, production = true }) {
  const app = express();
  app.disable("x-powered-by");
  if (production) app.set("trust proxy", 1);
  app.use((_req, res, next) => {
    res.set({
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
      "Referrer-Policy": "no-referrer",
      "Content-Security-Policy":
        "default-src 'none'; form-action 'self'; base-uri 'none'; frame-ancestors 'none'",
    });
    next();
  });
  app.use(
    rateLimit({
      windowMs: 60000,
      limit: 180,
      standardHeaders: true,
      legacyHeaders: false,
    }),
  );
  app.get("/health", (_req, res) => res.json({ status: "ok" }));
  app.get("/reference", (_req, res) =>
    res
      .type("text")
      .send(
        "WannaV read-only data reference. Open the corresponding ID using the authenticated MCP fetch tool. No student data is exposed on this page.",
      ),
  );
  app.use(
    mcpAuthRouter({
      provider,
      issuerUrl: new URL(origin),
      resourceServerUrl: new URL("/mcp", origin),
      scopesSupported: ["read"],
      resourceName: "WannaV 閲覧・検索・分析",
    }),
  );
  app.get("/oauth/google/callback", (req, res, next) =>
    provider.callback(req, res).catch(next),
  );
  app.post(
    "/oauth/consent",
    express.urlencoded({ extended: false, limit: "8kb" }),
    (req, res, next) => provider.consent(req, res).catch(next),
  );
  const auth = requireBearerAuth({
    verifier: provider,
    requiredScopes: ["read"],
    resourceMetadataUrl: getOAuthProtectedResourceMetadataUrl(
      new URL("/mcp", origin),
    ),
    expectedResource: new URL("/mcp", origin),
  });
  app.use("/mcp", auth);
  app.post("/mcp", express.json({ limit: "32kb" }), async (req, res, next) => {
    // New transport and server per request: no shared user session state.
    const server = createMcpServer({ sources, origin }),
      transport = new StreamableHTTPServerTransport({
        sessionIdGenerator: undefined,
        enableJsonResponse: true,
      });
    res.on("close", () => {
      transport.close();
      server.close();
    });
    try {
      await server.connect(transport);
      await transport.handleRequest(req, res, req.body);
    } catch (e) {
      if (!res.headersSent) next(e);
    }
  });
  app.all("/mcp", (_req, res) =>
    res.status(405).json({ error: "Use POST for the stateless MCP endpoint" }),
  );
  app.use((_error, _req, res, _next) =>
    res
      .status(500)
      .json({ error: "Request failed. No source data was changed." }),
  );
  return app;
}
