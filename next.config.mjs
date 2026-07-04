/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // OFFLINE_BUILD=1 时输出 standalone（自带精简 node_modules，纯 JS 跨平台），
  // 供内网 Windows/Linux 免 npm install 部署，见 scripts/package_offline_win.mjs。
  // 平时 dev / next start 流程不受影响。
  ...(process.env.OFFLINE_BUILD ? { output: "standalone" } : {}),
  eslint: {
    ignoreDuringBuilds: true,
  },
};

export default nextConfig;
