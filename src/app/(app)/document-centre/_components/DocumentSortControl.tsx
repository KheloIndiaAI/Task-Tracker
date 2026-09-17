'use client';

import { useRouter, useSearchParams } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';

import { DOC_SORTS, DOC_SORT_LABEL, type DocSort } from '@/lib/document-centre-shared';
import { cn } from '@/lib/utils';

/**
 * Sort dropdown for the Document Centre list. Pure URL state (?sort=).
 */
export function DocumentSortControl({ current }: { current: DocSort }) {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [open]);

  function pick(sort: DocSort) {
    const params = new URLSearchParams(searchParams.toString());
    if (sort === 'modified') params.delete('sort');
    else params.set('sort', sort);
    const qs = params.toString();
    router.push(qs ? `/document-centre?${qs}` : '/document-centre', { scroll: false });
    setOpen(false);
  }

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-haspopup="listbox"
        aria-expanded={open}
        className="inline-flex items-center gap-1.5 px-3 py-2 rounded-lg border border-line bg-panel text-[12px] font-medium text-ink-2 hover:border-ink-4 transition-colors"
      >
        <i className="ti ti-arrows-sort text-[14px]" aria-hidden="true" />
        <span className="hidden sm:inline">{DOC_SORT_LABEL[current].label}</span>
        <i className="ti ti-chevron-down text-[13px] text-ink-3" aria-hidden="true" />
      </button>

      {open ? (
        <div
          role="listbox"
          className="absolute right-0 z-40 mt-1 w-56 rounded-xl border border-line bg-panel shadow-card-hover p-1"
        >
          {DOC_SORTS.map((sort) => {
            const active = sort === current;
            return (
              <button
                key={sort}
                type="button"
                role="option"
                aria-selected={active}
                onClick={() => pick(sort)}
                className={cn(
                  'w-full flex flex-col items-start gap-0.5 px-3 py-2 rounded-lg text-left transition-colors',
                  active ? 'bg-primary-soft' : 'hover:bg-line-2',
                )}
              >
                <span className={cn('text-[12.5px] font-medium', active ? 'text-primary' : 'text-ink')}>
                  {DOC_SORT_LABEL[sort].label}
                </span>
                <span className="text-[11px] text-ink-3">{DOC_SORT_LABEL[sort].hint}</span>
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
