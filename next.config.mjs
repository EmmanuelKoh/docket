// next.config.mjs — Next.js shell config.
// The shell imports the existing lib/ modules unchanged; they need help
// from the bundler:
//   - The render/plugin dependencies stay external (loaded from
//     node_modules at runtime, not bundled): @resvg/resvg-js ships a native
//     .node binary, and node-ical breaks when Turbopack rewrites its
//     feature detection ("e.BigInt is not a function"). The rest are listed
//     defensively — they only ever run on the server, so bundling buys
//     nothing and risks the same class of breakage.
//   - /tick seeds templates from reference/*.json and every render loads
//     TTFs from render/fonts, both read with fs at runtime, so they must be
//     traced into the deployed function bundles.

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
    '/tick': ['./reference/**', './render/fonts/**'],
    '/ingest': ['./reference/**', './render/fonts/**'],
    '/preview': ['./render/fonts/**'],
    '/jobs': ['./render/fonts/**'],
    '/api/templates/thumb': ['./render/fonts/**'],
    '/api/jobs/reprint': ['./render/fonts/**'],
    '/api/slips/print-test': ['./render/fonts/**'],
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
