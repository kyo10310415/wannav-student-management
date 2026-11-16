import express from "express";
export function createSetupApp() {
  const app = express();
  app.disable("x-powered-by");
  app.use((_req, res, next) => {
    res.set({
      "Cache-Control": "no-store",
      "X-Content-Type-Options": "nosniff",
    });
    next();
  });
  app.get("/health", (_req, res) =>
    res.json({ status: "configuration_required", dataAccessEnabled: false }),
  );
  app.use((_req, res) =>
    res
      .status(503)
      .json({
        error:
          "Google OAuth configuration is pending. Data access is disabled.",
      }),
  );
  return app;
}
