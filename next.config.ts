import type { NextConfig } from "next";

const repository = process.env.GITHUB_REPOSITORY?.split("/")[1];
const basePath =
  process.env.GITHUB_ACTIONS === "true" && repository ? `/${repository}` : "";

const nextConfig: NextConfig = {
  output: "export",
  basePath,
};

export default nextConfig;
