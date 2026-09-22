import type { NextConfig } from "next";
const config: NextConfig = {
  turbopack: { root: process.cwd() },
  poweredByHeader: false,
  // Native binaries and the pdf.js worker must be required at runtime, not bundled.
  serverExternalPackages: ["sharp", "@napi-rs/canvas", "pdfjs-dist"],
  async headers() {
    return [
      {
        source: "/(.*)",
        headers: [
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          { key: "Referrer-Policy", value: "same-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
        ],
      },
    ];
  },
};
export default config;
