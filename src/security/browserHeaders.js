import { secureHeaders } from 'hono/secure-headers';

// Keep popup/SSO and external assets working; do not enable cross-origin isolation.
export const browserSecurityHeaders = secureHeaders({
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
});
