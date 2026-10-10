import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  allowedDevOrigins: (process.env.DEV_ALLOWED_ORIGINS || "localhost,127.0.0.1")
    .split(",").map((host) => host.trim()).filter(Boolean),
};

export default nextConfig;
