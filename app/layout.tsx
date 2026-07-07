import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'docket',
  description: 'Thermal-receipt platform',
};

// Same theme mechanism as the legacy dashboard (views/layout.liquid):
// localStorage key "docket-theme", data-theme="dark" stamped on <html>
// before first paint so there is no flash.
const themeInit = `
  if (localStorage.getItem('docket-theme') === 'dark') {
    document.documentElement.setAttribute('data-theme', 'dark');
  }
`;

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        {/* biome-ignore lint/security/noDangerouslySetInnerHtml: static theme bootstrap, no user input */}
        <script dangerouslySetInnerHTML={{ __html: themeInit }} />
      </head>
      <body>{children}</body>
    </html>
  );
}
