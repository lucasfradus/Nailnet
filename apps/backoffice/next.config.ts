import type { NextConfig } from "next";
const config: NextConfig = {
  transpilePackages: ["@nailnet/contracts", "@nailnet/database", "@nailnet/domain"],
  serverExternalPackages: ["@prisma/adapter-pg", "pg"],
  poweredByHeader: false,
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "same-origin" },
    ] }];
  },
};
export default config;
