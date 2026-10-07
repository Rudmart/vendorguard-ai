/** @type {import('next').NextConfig} */
const nextConfig = {
  // D3a: the shared permission catalog ships as TypeScript source.
  transpilePackages: ["@vendorguard/shared"],
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
