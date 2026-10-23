import type { NextConfig } from "next";

const distDir = process.env.CARE_DIST_DIR ?? ".next";
// Next owns and may clean this directory. Keep overrides in dedicated local build folders.
if (!/^\.next(?:-[a-zA-Z0-9][a-zA-Z0-9_-]*)?$/.test(distDir)) {
  throw new Error("CARE_DIST_DIR deve ser .next ou um diretório local como .next-preview ou .next-stable.");
}

const nextConfig: NextConfig = {
  distDir,
  poweredByHeader: false,
  devIndicators: false,
};

export default nextConfig;
