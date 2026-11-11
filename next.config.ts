import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  poweredByHeader: false,
  serverExternalPackages: ["nodemailer"],
  outputFileTracingIncludes: {
    // Brackets are literal segment names, so the glob escapes them.
    "/api/[[]...route[]]": [
      "./db/migrations/**/*.sql",
      "./config/timeline.json",
      "./config/timeline-terms.json",
      "./config/alerts.json",
      "./data/generated/*.geojson",
      "./data/generated/*.json",
      "./data/generated/*.csv",
    ],
    "/api/data/photos/**": ["./data/generated/photos/**"],
  },
  outputFileTracingExcludes: {
    // Photo files are the bulk of data/generated. A dynamic read of that
    // directory otherwise traces every image into every route that shares
    // the helper, and Vercel then splits the deployment past the Hobby cap.
    "/api/[[]...route[]]": ["./data/generated/photos/**"],
    "/admin": ["./data/generated/photos/**"],
    "/admin/**": ["./data/generated/photos/**"],
    "/api/data/photos/**": [
      "./data/generated/*.geojson",
      "./data/generated/*.json",
      "./data/generated/*.csv",
      "./data/cache/**",
    ],
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Robots-Tag", value: "noindex, nofollow" },
          { key: "Referrer-Policy", value: "no-referrer" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "X-Frame-Options", value: "DENY" },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
