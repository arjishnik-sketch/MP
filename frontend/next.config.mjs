/**
 * Purpose: Isolated Next.js shell for the Panchavati chart editor.
 * Current role: Routes browser API calls to Fastify; the frontend serves its own exact logo asset.
 * Last meaningful change: 2026-10-18 — production shell logo path fixed.
 * Constraint: The Fastify service remains the only data store and must be running locally.
 */
import path from "node:path";
import { fileURLToPath } from "node:url";

const fastifyUrl = process.env.FASTIFY_URL || "http://127.0.0.1:3100";
const frontendRoot = path.dirname(fileURLToPath(import.meta.url));

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: frontendRoot,
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${fastifyUrl}/api/:path*` },
    ];
  },
};

export default nextConfig;
