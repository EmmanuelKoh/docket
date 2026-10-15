// The dashboard shell: session gate, the panel (main navigation, see
// components/app-sidebar.tsx) and the content column, the only <main>.
// The session check (a signed cookie, no store read) is the only thing
// the shell waits for: the panel's printer line streams in inside
// Suspense, and loading.tsx fills the content column until the page is
// ready. The root layout already lays the printed ground under it.

import { redirect } from 'next/navigation';
import { Suspense } from 'react';
import { AppSidebar } from '@/components/app-sidebar';
import { ContentColumn, MAIN_ID } from '@/components/content-column';
import { TimeZoneCookie } from '@/components/time-zone-cookie';
import pkg from '@/package.json';
import { getCaller } from '../_lib/caller';
import { PrinterStatus } from './printer-status';

export default async function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  const caller = await getCaller();
  if (!caller) redirect('/login');

  return (
    <div className="hw-shell">
      <a href={`#${MAIN_ID}`} className="hw-skip">
        Skip to content
      </a>
      <AppSidebar
        status={
          <Suspense fallback={null}>
            <PrinterStatus caller={caller} />
          </Suspense>
        }
        isAdmin={caller.role === 'admin'}
        version={`v${pkg.version}`}
      />
      <ContentColumn>{children}</ContentColumn>
      <TimeZoneCookie />
    </div>
  );
}
