import type { Metadata } from 'next';
import { Big_Shoulders, Hanken_Grotesk, Martian_Mono } from 'next/font/google';
import './globals.css';

// Each page sets its own title: "Slips · DOCKET".
export const metadata: Metadata = {
  title: { default: 'DOCKET', template: '%s · DOCKET' },
  description: 'Receipts for a home thermal printer',
};

// The three E faces. They load here and only here: tests import the
// dashboard layout, and next/font needs the Next.js compiler.
// globals.css maps them to --font-sans, --font-mono and --font-display.
const hanken = Hanken_Grotesk({
  subsets: ['latin'],
  weight: ['400', '600', '700'],
  variable: '--font-hanken',
  display: 'swap',
});
// The width axis carries font-stretch 80 to 82% (codes, plates, legends).
const martian = Martian_Mono({
  subsets: ['latin'],
  axes: ['wdth'],
  variable: '--font-martian',
  display: 'swap',
});
// Google merged Big Shoulders Display into Big Shoulders. The kit pins the
// optical size axis to 72 (the display cut) wherever it uses this face.
const bigShoulders = Big_Shoulders({
  subsets: ['latin'],
  axes: ['opsz'],
  variable: '--font-big-shoulders',
  display: 'swap',
  // next/font has no metrics for this face, so it cannot size a fallback
  adjustFontFallback: false,
});

// Theme bootstrap: localStorage key "docket-theme", data-theme="dark"
// stamped on <html> before first paint so there is no flash.
const themeInit = `
  if (localStorage.getItem('docket-theme') === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
`;

// Every page, Login and Invite included, sits on the printed ground.
export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html
      lang="en"
      suppressHydrationWarning
      className={`${hanken.variable} ${martian.variable} ${bigShoulders.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body>
        <div className="hw-ground min-h-dvh">{children}</div>
      </body>
    </html>
  );
}
