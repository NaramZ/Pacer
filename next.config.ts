import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The Pacer browser extension (fixed ID from the key in extension/manifest.json) may call /api/ext/*;
  // those endpoints also require its connection code. Every other origin stays blocked.
  allowedDevOrigins: ["enjnnmjkimccakkbjklpnbdjjjenmiji"],
};

export default nextConfig;
