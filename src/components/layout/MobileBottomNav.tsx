'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useState, useEffect, useRef } from 'react';

import { cn } from '@/lib/utils';

type MobileBottomNavProps = {
  isSuperAdmin: boolean;
  isOsd: boolean;
  isJs: boolean;
  canAccessDocumentCentre: boolean;
  canAccessBusinessCards: boolean;
  canAccessTimelineFiles: boolean;
  unreadCount: number;
};

const PRIMARY_TABS = [
  { href: '/tasks', label: 'Tasks', icon: 'ti-checklist' },
  { href: '/timeline-files', label: 'Files', icon: 'ti-file-stack' },
  { href: '/calendar', label: 'Calendar', icon: 'ti-calendar' },
  { href: '/notifications', label: 'Alerts', icon: 'ti-bell' },
] as const;

const MORE_ITEMS = [
  { href: '/priority-board', label: 'Priority board', icon: 'ti-layout-kanban' },
  { href: '/profile', label: 'Profile', icon: 'ti-user' },
  { href: '/search', label: 'Search', icon: 'ti-search' },
] as const;

const ADMIN_MORE_ITEMS = [
  { href: '/command-centre', label: 'Command Centre', icon: 'ti-radar-2', osdOnly: true },
  { href: '/js-dashboard', label: 'JS Dashboard', icon: 'ti-bookmark-filled', jsOnly: true },
  { href: '/admin/structure', label: 'Structure', icon: 'ti-sitemap', adminOnly: true },
  { href: '/admin/users', label: 'Users', icon: 'ti-users', adminOnly: true },
] as const;

export function MobileBottomNav({
  isSuperAdmin,
  isOsd,
  isJs,
  canAccessDocumentCentre,
  canAccessBusinessCards,
  canAccessTimelineFiles,
  unreadCount,
}: MobileBottomNavProps) {
  const pathname = usePathname();

  // Hide the Files tab for barred slots (PMU Consultant); the row shrinks by one.
  const primaryTabs = canAccessTimelineFiles
    ? PRIMARY_TABS
    : PRIMARY_TABS.filter((tab) => tab.href !== '/timeline-files');
  const [moreOpen, setMoreOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    setMoreOpen(false);
  }, [pathname]);

  useEffect(() => {
    if (!moreOpen) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setMoreOpen(false);
    };
    const onClick = (e: MouseEvent) => {
      if (menuRef.current && !menuRef.current.contains(e.target as Node)) {
        setMoreOpen(false);
      }
    };
    window.addEventListener('keydown', onKey);
    window.addEventListener('mousedown', onClick);
    return () => {
      window.removeEventListener('keydown', onKey);
      window.removeEventListener('mousedown', onClick);
    };
  }, [moreOpen]);

  const isMoreActive =
    [...MORE_ITEMS, ...ADMIN_MORE_ITEMS].some((item) => isActive(pathname, item.href)) ||
    (canAccessDocumentCentre && isActive(pathname, '/document-centre')) ||
    (canAccessBusinessCards && isActive(pathname, '/business-cards'));

  return (
    <nav
      aria-label="Mobile navigation"
      className="fixed bottom-0 inset-x-0 z-30 md:hidden bg-panel border-t border-line safe-bottom"
    >
      <div
        className="grid h-14"
        style={{ gridTemplateColumns: `repeat(${primaryTabs.length + 1}, minmax(0, 1fr))` }}
      >
        {primaryTabs.map((tab) => {
          const active = isActive(pathname, tab.href);
          const showBadge = tab.href === '/notifications' && unreadCount > 0;
          return (
            <Link
              key={tab.href}
              href={tab.href}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'flex flex-col items-center justify-center gap-0.5 transition-colors relative',
                active ? 'text-primary' : 'text-ink-3',
              )}
            >
              <span className="relative">
                <i className={cn('ti', tab.icon, 'text-[20px]')} aria-hidden="true" />
                {showBadge ? (
                  <span className="absolute -top-1 -right-1.5 min-w-[16px] h-4 px-1 rounded-full bg-urgent text-white text-[9px] font-medium grid place-items-center">
                    {unreadCount > 99 ? '99+' : unreadCount}
                  </span>
                ) : null}
              </span>
              <span className="text-[10px] font-medium leading-none">{tab.label}</span>
            </Link>
          );
        })}

        {/* More button */}
        <div className="relative" ref={menuRef}>
          <button
            type="button"
            aria-label="More navigation options"
            aria-expanded={moreOpen}
            onClick={() => setMoreOpen(prev => !prev)}
            className={cn(
              'flex flex-col items-center justify-center gap-0.5 w-full h-full transition-colors',
              moreOpen || isMoreActive ? 'text-primary' : 'text-ink-3',
            )}
          >
            <i className={cn('ti ti-dots', 'text-[20px]')} aria-hidden="true" />
            <span className="text-[10px] font-medium leading-none">More</span>
          </button>

          {moreOpen ? (
            <div className="absolute bottom-full right-0 mb-2 mr-1 w-52 bg-panel rounded-xl border border-line shadow-xl overflow-hidden">
              {MORE_ITEMS.map((item) => (
                <MoreMenuItem
                  key={item.href}
                  href={item.href}
                  label={item.label}
                  icon={item.icon}
                  active={isActive(pathname, item.href)}
                />
              ))}
              {canAccessDocumentCentre ? (
                <MoreMenuItem
                  href="/document-centre"
                  label="Document Centre"
                  icon="ti-files"
                  active={isActive(pathname, '/document-centre')}
                />
              ) : null}
              {canAccessBusinessCards ? (
                <MoreMenuItem
                  href="/business-cards"
                  label="Business Cards"
                  icon="ti-address-book"
                  active={isActive(pathname, '/business-cards')}
                />
              ) : null}
              {(isSuperAdmin || isOsd || isJs) ? (
                <>
                  <div className="border-t border-line-2 mx-3" />
                  {ADMIN_MORE_ITEMS.map((item) => {
                    if ('osdOnly' in item && item.osdOnly && !isOsd) return null;
                    if ('jsOnly' in item && item.jsOnly && !isJs) return null;
                    if ('adminOnly' in item && item.adminOnly && !isSuperAdmin && !isOsd) return null;
                    return (
                      <MoreMenuItem
                        key={item.href}
                        href={item.href}
                        label={item.label}
                        icon={item.icon}
                        active={isActive(pathname, item.href)}
                      />
                    );
                  })}
                </>
              ) : null}
            </div>
          ) : null}
        </div>
      </div>
    </nav>
  );
}

function MoreMenuItem({
  href,
  label,
  icon,
  active,
}: {
  href: string;
  label: string;
  icon: string;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      aria-current={active ? 'page' : undefined}
      className={cn(
        'flex items-center gap-3 px-4 py-3 text-[13px] font-medium transition-colors',
        active ? 'text-primary bg-primary-soft' : 'text-ink-2 hover:bg-line-2',
      )}
    >
      <i className={cn('ti', icon, 'text-[18px]')} aria-hidden="true" />
      {label}
    </Link>
  );
}

function isActive(pathname: string | null, href: string) {
  if (!pathname) return false;
  if (href === '/tasks') return pathname === '/tasks' || pathname.startsWith('/tasks/');
  return pathname === href || pathname.startsWith(href + '/');
}
