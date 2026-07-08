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
  serverExternalPackages: [
    '@resvg/resvg-js',
    '@upstash/redis',
    '@vercel/blob',
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
    '/api/recipes/print-test': ['./render/fonts/**'],
  },
  // Muscle memory from the legacy app: the dashboard used to live under
  // /dashboard/*; send old bookmarks to the shell.
  async redirects() {
    return [
      { source: '/dashboard', destination: '/', permanent: false },
      { source: '/dashboard/:path*', destination: '/', permanent: false },
    ];
  },
};

export default nextConfig;
