/** @type {import('next').NextConfig} */
const nativeServerPackages = [
  "@neplex/vectorizer",
  "@resvg/resvg-js",
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    serverComponentsExternalPackages: nativeServerPackages,
  },
  webpack(config, { isServer }) {
    if (isServer) {
      const existing = Array.isArray(config.externals)
        ? config.externals
        : config.externals
          ? [config.externals]
          : [];
      config.externals = [...existing, ...nativeServerPackages];
    }
    return config;
  },
};

export default nextConfig;
