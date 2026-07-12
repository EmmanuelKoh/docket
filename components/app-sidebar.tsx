'use client';

// The app sidebar — collapsible to an icon rail (byos_next's shell
// pattern), styled by the docket spec: quiet ink-muted items, the active
// item gains ink text plus a 1.5px register-red bar at its left edge (the
// vertical cousin of the legacy nav's red underline). The queue item
// carries a count badge, red only when nonzero (red-usage rule 4).

import {
  AudioLines,
  Camera,
  History,
  House,
  Layers,
  Printer,
  ReceiptText,
  Users,
} from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  Sidebar,
  SidebarContent,
  SidebarGroup,
  SidebarGroupContent,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarRail,
} from '@/components/ui/sidebar';

const NAV = [
  { title: 'Overview', url: '/', icon: House },
  { title: 'Slips', url: '/slips', icon: ReceiptText },
  { title: 'Photo', url: '/photo', icon: Camera },
  { title: 'Tape', url: '/tape', icon: AudioLines },
  { title: 'Queue', url: '/queue', icon: Layers },
  { title: 'History', url: '/history', icon: History },
  { title: 'Printer', url: '/printer', icon: Printer },
];

const ACTIVE_BAR =
  'relative data-[active=true]:text-ink ' +
  "data-[active=true]:before:absolute data-[active=true]:before:content-[''] " +
  'data-[active=true]:before:left-0 data-[active=true]:before:top-1.5 ' +
  'data-[active=true]:before:bottom-1.5 data-[active=true]:before:w-[1.5px] ' +
  'data-[active=true]:before:bg-red';

export function AppSidebar({
  queueCount,
  isAdmin = false,
}: {
  queueCount: number;
  isAdmin?: boolean;
}) {
  const pathname = usePathname();
  const nav = isAdmin
    ? [...NAV, { title: 'Users', url: '/users', icon: Users }]
    : NAV;

  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>
        <Link
          href="/"
          className="px-2 py-1.5 font-mono text-sm font-medium tracking-[0.14em] text-ink group-data-[collapsible=icon]:hidden"
        >
          DOCKET
        </Link>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <SidebarMenu>
              {nav.map((item) => (
                <SidebarMenuItem key={item.url}>
                  <SidebarMenuButton
                    asChild
                    isActive={
                      pathname === item.url ||
                      (item.url !== '/' && pathname.startsWith(`${item.url}/`))
                    }
                    tooltip={item.title}
                    className={ACTIVE_BAR}
                  >
                    <Link href={item.url}>
                      <item.icon className="text-ink-faint" />
                      <span>{item.title}</span>
                    </Link>
                  </SidebarMenuButton>
                  {item.url === '/queue' && queueCount > 0 ? (
                    <SidebarMenuBadge className="font-mono text-red">
                      {queueCount}
                    </SidebarMenuBadge>
                  ) : null}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarRail />
    </Sidebar>
  );
}
