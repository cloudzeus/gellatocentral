import type { NextConfig } from "next";

// Κεφαλίδες ασφάλειας σε κάθε απάντηση. Το CSP επιτρέπει μόνο δικό μας περιεχόμενο· τα inline scripts/styles
// τα χρειάζεται το ίδιο το Next (hydration) και το Tailwind.
// shortcut: 'unsafe-inline' στα scripts· πριν από την παραγωγή να γίνει CSP με nonce ανά αίτημα (proxy.ts).
const securityHeaders = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
  {
    key: "Content-Security-Policy",
    value: ["default-src 'self'", `script-src 'self' 'unsafe-inline'${process.env.NODE_ENV === "production" ? "" : " 'unsafe-eval'"}`, "style-src 'self' 'unsafe-inline'", `img-src 'self' data: https://*.b-cdn.net${process.env.BUNNY_CDN_URL ? ` ${new URL(process.env.BUNNY_CDN_URL).origin}` : ""}`, "font-src 'self'", "connect-src 'self'", "frame-src 'self'", "frame-ancestors 'none'", "form-action 'self' https://www.vivapayments.com https://demo.vivapayments.com", "base-uri 'self'", "object-src 'none'"].join("; "),
  },
];

const nextConfig: NextConfig = {
  // ο κόμβος δεν κρατά τίποτα δικό του στον δίσκο: έτσι τρέχουν όσα αντίγραφα θέλουμε πίσω από load balancer
  output: "standalone",
  poweredByHeader: false,
  headers: async () => [{ source: "/:path*", headers: securityHeaders }],
  // ανάπτυξη: η εφαρμογή ανοίγει και από 127.0.0.1, όχι μόνο από localhost
  allowedDevOrigins: ["127.0.0.1"],
  /* config options here */
  cacheComponents: true,
  partialPrefetching: true,
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
