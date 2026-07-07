// The dashboard shell: session gate, sidebar, slim header (sidebar
// trigger, theme toggle, logout) with the identity-defining 1.5px ink
// bottom rule, and the content column (max 1120px, gutters that never
// drop below 48px on desktop, 16px on phones — spec spacing system).

import { LogOut } from 'lucide-react';
import { redirect } from 'next/navigation';
import { AppSidebar } from '@/components/app-sidebar';
import { ThemeToggle } from '@/components/theme-toggle';
import {
  SidebarInset,
  SidebarProvider,
  SidebarTrigger,
} from '@/components/ui/sidebar';
import { listJobs } from '@/lib/job-store.js';
import { sessionValid } from '../_lib/dashboard-session';
import type { JobSummary } from '../_lib/format';

export default async function DashboardLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  if (!(await sessionValid())) redirect('/login');

  const jobs = (await listJobs(1000)) as JobSummary[];
  const queueCount = jobs.filter(
    (j) => j.status === 'queued' || j.status === 'inflight',
  ).length;

  return (
    <SidebarProvider>
      <AppSidebar queueCount={queueCount} />
      <SidebarInset className="bg-transparent">
        <header className="flex items-center justify-between border-b-[1.5px] border-b-ink px-4 py-3">
          <SidebarTrigger className="text-ink-faint hover:text-ink" />
          <div className="flex items-center gap-5">
            <ThemeToggle />
            <a
              href="/logout"
              aria-label="Sign out"
              className="text-ink-faint transition-colors hover:text-ink"
            >
              <LogOut size={15} />
            </a>
          </div>
        </header>
        <main className="mx-auto w-full max-w-[1120px] px-4 py-6 sm:px-12">
          {children}
        </main>
      </SidebarInset>
    </SidebarProvider>
  );
}
