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
const imageHeaders = secureHeaders({
  ...headerOptions,
  contentSecurityPolicy: { ...headerOptions.contentSecurityPolicy, defaultSrc: ["'none'"], sandbox: [] }
});
const exportHeaders = scriptPolicy(["'self'"]);
const cdnScriptHeaders = scriptPolicy(["'self'", 'https://cdn.tailwindcss.com']);
const redlistHeaders = scriptPolicy(["'self'", 'https://cdn.tailwindcss.com', 'https://cdn.jsdelivr.net/npm/axios@1.6.0/dist/axios.min.js']);
const cdnScriptPages = new Set(['/redlist-update.html', '/test-discord.html', '/vq-resend.html']);

export const browserSecurityHeaders = (c, next) => {
  // Match the static server's URI decoding so encoded aliases retain the policy.
  let pagePath = c.req.path;
  try { pagePath = decodeURI(pagePath); } catch { /* Invalid URIs are handled by routing/static serving. */ }
  if (/^\/api\/red-list\/messages\/[^/]+\/image\/?$/.test(pagePath)) return imageHeaders(c, next);
  if (pagePath === '/funnel-analysis-export.html') return exportHeaders(c, next);
  if (pagePath === '/redlist.html') return redlistHeaders(c, next);
  if (cdnScriptPages.has(pagePath)) return cdnScriptHeaders(c, next);
  return defaultHeaders(c, next);
};
