'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';

import { cn } from '@/lib/utils';

/**
 * Side navigation.
 *
 * Visibility:
 *   - mobile (< md)  : hidden (rendered inside MobileNavDrawer instead)
 *   - tablet (md..lg): icons only, 64px wide
 *   - laptop (lg+)   : labels visible, 240px wide
 *
 * Phase markers: items the user can navigate to today have full colour.
 * Items for upcoming phases get a "Soon" pill and are still clickable
 * (they land on the "Coming soon" placeholder).
 */

type Item = {
  href: string;
  label: string;
  icon: string;
  phase?: 1 | 2 | 3 | 4;
  adminOnly?: boolean;
  /** External platform — opens in a new tab with an external-link marker. */
  external?: boolean;
};

const PRIMARY_ITEMS: Item[] = [
  { href: '/tasks', label: 'Tasks', icon: 'ti-checklist', phase: 1 },
  { href: '/priority-board', label: 'Priority board', icon: 'ti-layout-kanban', phase: 1 },
  { href: '/timeline-files', label: 'Timeline files', icon: 'ti-file-stack', phase: 1 },
  { href: '/calendar', label: 'Calendar', icon: 'ti-calendar', phase: 1 },
  { href: '/notifications', label: 'Notifications', icon: 'ti-bell', phase: 1 },
  { href: '/profile', label: 'Profile', icon: 'ti-user', phase: 1 },
];

const ADMIN_ITEMS: Item[] = [
  { href: '/admin/structure', label: 'Structure & hierarchy', icon: 'ti-sitemap', phase: 1, adminOnly: true },
  { href: '/admin/users', label: 'Users', icon: 'ti-users', phase: 1, adminOnly: true },
];

type SidebarProps = {
  isSuperAdmin: boolean;
  /** OSD or Super Admin — gates Command Centre */
  isOsd: boolean;
  /** JS slot — gates JS Dashboard */
  isJs: boolean;
  /** Super Admins + the osd.myas account — gates the Tour report link */
  showTourReport?: boolean;
  /** Super Admins + the OSD desks — gates the Document Centre link */
  canAccessDocumentCentre?: boolean;
  canAccessBusinessCards?: boolean;
  /** False for barred slots (PMU Consultant) — hides the Timeline files link */
  canAccessTimelineFiles?: boolean;
  /** mobile drawer mode renders labels regardless of breakpoint */
  drawerMode?: boolean;
  onNavigate?: () => void;
};

const COMMAND_CENTRE_ITEM: Item = {
  href: '/command-centre',
  label: 'Command Centre',
  icon: 'ti-radar-2',
  phase: 1,
};

const JS_DASHBOARD_ITEM: Item = {
  href: '/js-dashboard',
  label: 'JS Dashboard',
  icon: 'ti-bookmark-filled',
  phase: 1,
};

const TOUR_REPORT_ITEM: Item = {
  href: 'https://tourvisits.vercel.app/',
  label: 'Tour report',
  icon: 'ti-plane-departure',
  phase: 1,
  external: true,
};

const DOCUMENT_CENTRE_ITEM: Item = {
  href: '/document-centre',
  label: 'Document Centre',
  icon: 'ti-files',
  phase: 1,
};

const BUSINESS_CARDS_ITEM: Item = {
  href: '/business-cards',
  label: 'Business Cards',
  icon: 'ti-address-book',
  phase: 1,
};

export function Sidebar({
  isSuperAdmin,
  isOsd,
  isJs,
  showTourReport = false,
  canAccessDocumentCentre = false,
  canAccessBusinessCards = false,
  canAccessTimelineFiles = true,
  drawerMode = false,
  onNavigate,
}: SidebarProps) {
  const pathname = usePathname();

  // Hide the Timeline files link for barred slots (PMU Consultant).
  const primaryItems = canAccessTimelineFiles
    ? PRIMARY_ITEMS
    : PRIMARY_ITEMS.filter((item) => item.href !== '/timeline-files');

  return (
    <nav
      aria-label="Primary"
      className={cn(
        'flex flex-col gap-1 py-4',
        drawerMode ? 'px-3' : 'px-2 lg:px-3',
      )}
    >
      <Group label="Workspace" drawerMode={drawerMode} />
      {isOsd ? (
        <NavItem
          item={COMMAND_CENTRE_ITEM}
          active={isActive(pathname, COMMAND_CENTRE_ITEM.href)}
          drawerMode={drawerMode}
          onClick={onNavigate}
        />
      ) : null}
      {isJs ? (
        <NavItem
          item={JS_DASHBOARD_ITEM}
          active={isActive(pathname, JS_DASHBOARD_ITEM.href)}
          drawerMode={drawerMode}
          onClick={onNavigate}
        />
      ) : null}
      {primaryItems.map((item) => (
        <NavItem
          key={item.href}
          item={item}
          active={isActive(pathname, item.href)}
          drawerMode={drawerMode}
          onClick={onNavigate}
        />
      ))}
      {canAccessDocumentCentre ? (
        <NavItem
          item={DOCUMENT_CENTRE_ITEM}
          active={isActive(pathname, DOCUMENT_CENTRE_ITEM.href)}
          drawerMode={drawerMode}
          onClick={onNavigate}
        />
      ) : null}
      {canAccessBusinessCards ? (
        <NavItem
          item={BUSINESS_CARDS_ITEM}
          active={isActive(pathname, BUSINESS_CARDS_ITEM.href)}
          drawerMode={drawerMode}
          onClick={onNavigate}
        />
      ) : null}
      {showTourReport ? (
        <NavItem
          item={TOUR_REPORT_ITEM}
          active={false}
          drawerMode={drawerMode}
          onClick={onNavigate}
        />
      ) : null}

      {isSuperAdmin || isOsd ? (
        <>
          <Group label="Super Admin" drawerMode={drawerMode} className="mt-4" />
          {ADMIN_ITEMS.map((item) => (
            <NavItem
              key={item.href}
              item={item}
              active={isActive(pathname, item.href)}
              drawerMode={drawerMode}
              onClick={onNavigate}
            />
          ))}
        </>
      ) : null}
    </nav>
  );
}

function isActive(pathname: string | null, href: string) {
  if (!pathname) return false;
  if (href === '/tasks') return pathname === '/tasks' || pathname.startsWith('/tasks/');
  return pathname === href || pathname.startsWith(href + '/');
}

function NavItem({
  item,
  active,
  drawerMode,
  onClick,
}: {
  item: Item;
  active: boolean;
  drawerMode: boolean;
  onClick?: () => void;
}) {
  const soon = item.phase && item.phase > 1;

  const inner = (
    <>
      <i
        className={cn(
          'ti',
          item.icon,
          'text-[18px] shrink-0',
          active ? 'text-primary' : 'text-ink-3 group-hover:text-ink-2',
        )}
        aria-hidden="true"
      />
      <span
        className={cn(
          'text-[13px] font-medium leading-none flex-1',
          drawerMode ? 'block' : 'hidden lg:block',
        )}
      >
        {item.label}
      </span>
      {item.external ? (
        <i
          className={cn(
            'ti ti-external-link text-[13px] text-ink-3',
            drawerMode ? 'block' : 'hidden lg:block',
          )}
          aria-hidden="true"
        />
      ) : null}
      {soon ? (
        <span
          className={cn(
            'text-[9px] uppercase tracking-[0.06em] font-medium px-1.5 py-0.5 rounded-md bg-line-2 text-ink-3',
            drawerMode ? 'block' : 'hidden lg:block',
          )}
        >
          Soon
        </span>
      ) : null}
    </>
  );

  const classes = cn(
    'group relative flex items-center gap-3 rounded-lg transition-colors',
    drawerMode ? 'px-3 py-2.5' : 'px-2.5 py-2 lg:px-3 lg:py-2.5',
    active
      ? 'bg-primary-soft text-primary'
      : 'text-ink-2 hover:bg-line-2 hover:text-ink',
  );

  // External platforms open in a new tab so the workspace stays put —
  // no losing scroll position, filters, or an open task mid-thought.
  if (item.external) {
    return (
      <a
        href={item.href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={onClick}
        aria-label={`${item.label} (opens in a new tab)`}
        className={classes}
      >
        {inner}
      </a>
    );
  }

  return (
    <Link
      href={item.href}
      onClick={onClick}
      aria-current={active ? 'page' : undefined}
      className={classes}
    >
      {inner}
    </Link>
  );
}

function Group({
  label,
  drawerMode,
  className,
}: {
  label: string;
  drawerMode: boolean;
  className?: string;
}) {
  return (
    <h2
      className={cn(
        'text-[9px] uppercase tracking-[0.1em] text-ink-3 font-medium px-3 mb-1',
        drawerMode ? 'block' : 'hidden lg:block',
        className,
      )}
    >
      {label}
    </h2>
  );
}
