/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'card-images.netrunnerdb.com' },
    ],
  },
  // Next.js blocks cross-origin dev-server requests by default (only
  // `localhost` is allowed out of the box). Accessing `npm run dev` through
  // the local nginx proxy at http://netrunner.test (see deploy/nginx.dev.conf)
  // needs this origin explicitly allowlisted, or HMR's WebSocket connection
  // fails. Does not affect production builds (`next start`).
  allowedDevOrigins: ['netrunner.test'],
}

export default nextConfig
