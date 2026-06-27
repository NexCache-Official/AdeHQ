/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  eslint: {
    // Keep the demo build green on stylistic lint; TypeScript checks still run.
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
