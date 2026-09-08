/** @type {import('next').NextConfig} */
const nextConfig = {
  // Docker 이미지를 최소 런타임 파일만 포함하도록 빌드하기 위함 (Dockerfile.web 참고).
  output: "standalone",
};

module.exports = nextConfig;
