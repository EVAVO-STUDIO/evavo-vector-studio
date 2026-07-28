/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: ["@neplex/vectorizer"],
  },
};

export default nextConfig;
