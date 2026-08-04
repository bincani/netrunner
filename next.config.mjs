/** @type {import('next').NextConfig} */
const nextConfig = {
  images: {
    remotePatterns: [
      { protocol: 'https', hostname: 'card-images.netrunnerdb.com' },
    ],
  },
}

export default nextConfig
