/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'card-images.netrunnerdb.com' },
    ],
  },
  // Next.js blocks cross-origin dev-server requests by default (only
  // `localhost` is allowed out of the box). Accessing `npm run dev` through
  // an nginx proxy under any other hostname needs that origin explicitly
  // allowlisted here, or HMR's WebSocket connection fails (confirmed: the
  // dev server returns a malformed response to the WS upgrade when the
  // Origin header doesn't match, which browsers surface as a plain
  // "WebSocket connection failed"). Does not affect production builds
  // (`next start`) — only `next dev`.
  allowedDevOrigins: [
    'netrunner.test', // local dev, see deploy/nginx.dev.conf
    'netrunner.benno.ap-southeast-2.staging.factoryx.io', // staging
  ],
}

export default nextConfig
