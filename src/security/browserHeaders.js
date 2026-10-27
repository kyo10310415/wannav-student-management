import { secureHeaders } from 'hono/secure-headers';

// Keep popup/SSO and external assets working; do not enable cross-origin isolation.
const headerOptions = {
  crossOriginEmbedderPolicy: false,
  crossOriginResourcePolicy: false,
  crossOriginOpenerPolicy: false,
  originAgentCluster: false,
  referrerPolicy: 'strict-origin-when-cross-origin',
  // Start with one day, without subdomain or preload commitments.
  strictTransportSecurity: 'max-age=86400',
  xContentTypeOptions: 'nosniff',
  xFrameOptions: 'DENY',
  xDnsPrefetchControl: false,
  xDownloadOptions: false,
  xPermittedCrossDomainPolicies: false,
  xXssProtection: false,
  removePoweredBy: false,
  contentSecurityPolicy: {
    baseUri: ["'self'"],
    formAction: ["'self'"],
    objectSrc: ["'none'"],
    frameAncestors: ["'none'"]
  }
};

const defaultHeaders = secureHeaders(headerOptions);
const scriptPolicy = (sources) => secureHeaders({
  ...headerOptions,
  contentSecurityPolicy: {
    ...headerOptions.contentSecurityPolicy,
    scriptSrcElem: sources,
    scriptSrcAttr: ["'none'"]
  }
});
const exportHeaders = scriptPolicy(["'self'"]);
const cdnScriptHeaders = scriptPolicy(["'self'", 'https://cdn.tailwindcss.com']);
const cdnScriptPages = new Set(['/redlist-update.html', '/test-discord.html', '/vq-resend.html']);

export const browserSecurityHeaders = (c, next) => {
  // Match the static server's URI decoding so encoded aliases retain the policy.
  let pagePath = c.req.path;
  try { pagePath = decodeURI(pagePath); } catch { /* Invalid URIs are handled by routing/static serving. */ }
  if (pagePath === '/funnel-analysis-export.html') return exportHeaders(c, next);
  if (cdnScriptPages.has(pagePath)) return cdnScriptHeaders(c, next);
  return defaultHeaders(c, next);
};
