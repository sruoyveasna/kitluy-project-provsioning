/** @type {import("next").NextConfig} */
const nextConfig = {
  transpilePackages: [
    "@kitluy/web-ui",
    "@kitluy/localization",
    "@kitluy/feature-flags",
    "@kitluy/shared-types",
  ],
};

export default nextConfig;
