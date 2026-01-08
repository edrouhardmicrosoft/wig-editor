import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Transpile sandpack packages for better Turbopack compatibility
  transpilePackages: [
    "@codesandbox/sandpack-react",
    "@codesandbox/sandpack-client",
  ],
};

export default nextConfig;
