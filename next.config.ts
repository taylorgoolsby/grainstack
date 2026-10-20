import type { NextConfig } from "next";

// This app runs as a long-lived Node server (`npm run build && npm start`), not on a serverless
// host: provisioning runs for minutes inside the server process after signup returns.
const nextConfig: NextConfig = {};

export default nextConfig;
