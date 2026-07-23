const contentSecurityPolicy = [
  "default-src 'self'",
  "base-uri 'self'",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "form-action 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https:",
  "font-src 'self' data:",
  "connect-src 'self' https: wss:",
  "media-src 'self' blob: https:",
  "worker-src 'self' blob:",
  "frame-src 'self' https://*.revolut.com https://*.vercel.live",
  "upgrade-insecure-requests",
].join("; ");

const securityHeaders = [
  { key: "Content-Security-Policy", value: contentSecurityPolicy },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), geolocation=(), microphone=(self), payment=(self), usb=()",
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: {
    // Keep the demo build green on stylistic lint; TypeScript checks still run.
    ignoreDuringBuilds: true,
  },
  // pdf-parse v2 needs its worker + native canvas outside the Next bundle on Vercel.
  serverExternalPackages: [
    "@browserbasehq/stagehand",
    "@napi-rs/canvas",
    "pdf-parse",
    "pdfjs-dist",
  ],
  experimental: {
    serverComponentsExternalPackages: [
      "@browserbasehq/stagehand",
      "@napi-rs/canvas",
      "pdf-parse",
      "pdfjs-dist",
    ],
  },
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: securityHeaders,
      },
    ];
  },
};

export default nextConfig;
