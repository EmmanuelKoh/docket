// next.config.mjs — Next.js shell config.
// The shell imports the existing lib/ modules unchanged; they need help
// from the bundler:
//   - The render/plugin dependencies stay external (loaded from
//     node_modules at runtime, not bundled): @resvg/resvg-js ships a native
//     .node binary, and node-ical breaks when Turbopack rewrites its
//     feature detection ("e.BigInt is not a function"). The rest are listed
//     defensively — they only ever run on the server, so bundling buys
//     nothing and risks the same class of breakage.
//   - Template seeding reads reference/*.json (the sign-up hook in
//     /api/auth, the Slips pages, /ingest; never /tick) and every render
//     loads TTFs from render/fonts, both with fs at runtime, so they must
//     be traced into the deployed function bundles. Keys match as
//     substrings: '/slips' also covers /api/slips/*.

/** @type {import('next').NextConfig} */
const nextConfig = {
  // Dev only: Next 16 rejects dev-runtime requests (HMR socket, Turbopack
  // internals) from any origin but localhost, which breaks phone testing
  // over the LAN IP or a cloudflared/ngrok tunnel — the page loads but
  // never hydrates. Allowlist those origins so it comes alive off-device.
  allowedDevOrigins: ['192.168.1.157', '*.trycloudflare.com', '*.ngrok-free.app'],
  serverExternalPackages: [
    '@electric-sql/pglite',
    '@neondatabase/serverless',
    '@resvg/resvg-js',
    '@upstash/redis',
    '@vercel/blob',
    'drizzle-orm',
    'liquidjs',
    'node-ical',
    'pngjs',
    'satori',
    'satori-html',
  ],
  outputFileTracingIncludes: {
    '/tick': ['./render/fonts/**'],
    '/ingest': ['./reference/**', './render/fonts/**'],
    // Keys are picomatch globs, so brackets are escaped: '[...all]'
    // unescaped is a character class and never matches
    // (tests/route-config.test.ts checks every key).
    '/api/auth/\\[...all\\]': ['./reference/**'],
    '/slips': ['./reference/**'],
    '/slips/\\[slug\\]': ['./reference/**'],
    '/preview': ['./render/fonts/**'],
    '/jobs': ['./render/fonts/**'],
    '/api/templates/thumb': ['./render/fonts/**'],
    '/api/jobs/reprint': ['./render/fonts/**'],
    '/api/slips/print-test': ['./render/fonts/**'],
  },
  // The kit's sprites (public/hardware/*.png) are cached for good: a page
  // load then sends no request for them, and each request counts against
  // the CDN's monthly cap (docs/store-costs.md). Next serves public files
  // with max-age=0 otherwise. Give a sprite a new file name whenever its
  // pixels change, or browsers keep the old one.
  async headers() {
    return [
      {
        source: '/hardware/:path*',
        headers: [
          {
            key: 'Cache-Control',
            value: 'public, max-age=31536000, immutable',
          },
        ],
      },
    ];
  },
  // Old bookmarks: the dashboard used to live under /dashboard/*, and the
  // Slips page was briefly at /recipes. Send both to their current homes.
  async redirects() {
    return [
      { source: '/dashboard', destination: '/', permanent: false },
      { source: '/dashboard/:path*', destination: '/', permanent: false },
      { source: '/recipes', destination: '/slips', permanent: false },
      { source: '/recipes/:slug', destination: '/slips/:slug', permanent: false },
    ];
  },
};

export default nextConfig;
