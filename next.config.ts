import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  serverExternalPackages: ['better-sqlite3'],
  turbopack: {},
  async rewrites() {
    return {
      beforeFiles: [
        {
          source: '/api/voice/:path*',
          destination: 'http://127.0.0.1:8000/api/voice/:path*',
        },
        {
          source: '/api/voice',
          destination: 'http://127.0.0.1:8000/api/voice',
        },
        {
          source: '/api/android',
          destination: 'http://127.0.0.1:8000/api/android',
        }
      ]
    };
  },
};

export default nextConfig;
