/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  transpilePackages: ["@yeyak/types", "@yeyak/resy"],
  experimental: {
    // enable async Request APIs compat
  },
};

export default nextConfig;
