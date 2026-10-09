/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  distDir: process.env.NEXT_DIST_DIR || ".next",
  images: {
    remotePatterns: [
      { protocol: "https", hostname: "image.tmdb.org", pathname: "/t/p/**" },
    ],
  },
  async headers() {
    return [{
      source: "/:path*",
      headers: [{
        key: "Content-Security-Policy",
        value: "default-src 'self'; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline'; img-src 'self' data: https://image.tmdb.org; media-src 'self' https://www.youtube.com https://youtube.com; frame-src https://www.youtube-nocookie.com https://www.youtube.com; connect-src 'self' https://api.themoviedb.org https://www.omdbapi.com",
      }],
    }];
  },
};

module.exports = nextConfig;