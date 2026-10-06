import type { NextConfig } from "next";
const config: NextConfig = {
  transpilePackages: ["@nailnet/contracts", "@nailnet/database", "@nailnet/domain"],
  serverExternalPackages: ["@prisma/adapter-pg", "pg"],
  poweredByHeader: false,
  // Fotos de servicios y profesionales (8 MB de imagen más el resto del formulario).
  experimental: { serverActions: { bodySizeLimit: "9mb" } },
  async headers() {
    return [{ source: "/:path*", headers: [
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "same-origin" },
    ] }];
  },
};
export default config;
