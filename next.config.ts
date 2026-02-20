import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  /* config options here */
  // Ignore app/ directory at root to avoid conflicts
  // Next.js will automatically use src/app/ as source directory
  pageExtensions: ['tsx', 'ts', 'jsx', 'js'],
  
  // Allow importing JSON files from root and src/
  webpack: (config, { isServer }) => {
    // Allow importing JSON from project root
    config.resolve.alias = {
      ...config.resolve.alias,
    };
    return config;
  },
};

export default nextConfig;
