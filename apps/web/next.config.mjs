/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["@neplex/vectorizer", "@resvg/resvg-js"],
  },
};

export default nextConfig;
