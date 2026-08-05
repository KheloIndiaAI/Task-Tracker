'use client';

import { useEffect } from 'react';

import { Sidebar } from './Sidebar';
import { cn } from '@/lib/utils';

type MobileNavDrawerProps = {
  open: boolean;
  onClose: () => void;
  isSuperAdmin: boolean;
  isOsd: boolean;
  isJs: boolean;
  showTourReport: boolean;
  canAccessDocumentCentre: boolean;
  canAccessBusinessCards: boolean;
  canAccessTimelineFiles: boolean;
};

/**
 * Slide-out drawer that hosts the Sidebar on mobile.
 * Trapped via Esc + backdrop click. No body-scroll lock (modern viewport
 * unit handling is enough); revisit if iOS Safari shows weirdness.
 */
export function MobileNavDrawer({
  open,
  onClose,
  isSuperAdmin,
  isOsd,
  isJs,
  showTourReport,
  canAccessDocumentCentre,
  canAccessBusinessCards,
  canAccessTimelineFiles,
}: MobileNavDrawerProps) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  return (
    <>
      {/* Backdrop */}
      <div
        aria-hidden="true"
        onClick={onClose}
        className={cn(
          'fixed inset-0 z-40 bg-black/40 transition-opacity md:hidden',
          open ? 'opacity-100 pointer-events-auto' : 'opacity-0 pointer-events-none',
        )}
      />

      {/* Drawer */}
      <aside
        aria-label="Navigation"
        aria-hidden={!open}
        className={cn(
          'fixed inset-y-0 left-0 z-50 w-[280px] bg-panel border-r border-line shadow-xl',
          'transition-transform duration-200 ease-out md:hidden',
          open ? 'translate-x-0' : '-translate-x-full',
        )}
      >
        <div className="px-5 py-4 border-b border-line-2 flex items-center justify-between">
          <h2 className="font-serif text-[20px] leading-none">Tasks</h2>
          <button
            type="button"
            aria-label="Close navigation"
            onClick={onClose}
            className="w-9 h-9 grid place-items-center text-ink-2 rounded-full hover:bg-line-2"
          >
            <i className="ti ti-x text-[20px]" aria-hidden="true" />
          </button>
        </div>
        <Sidebar
          isSuperAdmin={isSuperAdmin}
          isOsd={isOsd}
          isJs={isJs}
          showTourReport={showTourReport}
          canAccessDocumentCentre={canAccessDocumentCentre}
          canAccessBusinessCards={canAccessBusinessCards}
          canAccessTimelineFiles={canAccessTimelineFiles}
          drawerMode
          onNavigate={onClose}
        />
      </aside>
    </>
  );
}
