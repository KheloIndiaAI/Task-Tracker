'use client';

import { useEffect, useMemo, useRef, useState } from 'react';

import type { BusinessCardDto, BusinessCardEventDto } from '@/lib/business-cards-shared';
import { cn } from '@/lib/utils';

import { BusinessCardDialog } from './BusinessCardDialog';
import { BusinessCardInteractive } from './BusinessCardInteractive';

/**
 * Client-side browse over the full (access-gated) card list: a global search
 * across every field plus a multi-select Event filter with its own quick
 * search. The dataset is bounded (contacts collected at events), so filtering
 * in memory keeps the interaction instant and avoids a search endpoint.
 */
export function BusinessCardsBrowser({
  cards,
  events,
  s3Configured,
}: {
  cards: BusinessCardDto[];
  events: BusinessCardEventDto[];
  s3Configured: boolean;
}) {
  const [query, setQuery] = useState('');
  const [selectedEvents, setSelectedEvents] = useState<Set<string>>(new Set());

  const searchable = useMemo(
    () =>
      cards.map((c) => ({
        card: c,
        hay: [
          c.fullName,
          c.company,
          c.jobTitle,
          c.industry,
          c.email,
          c.mobile,
          c.remarks,
          c.eventName,
        ]
          .filter(Boolean)
          .join(' ')
          .toLowerCase(),
      })),
    [cards],
  );

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return searchable
      .filter(({ card, hay }) => {
        if (selectedEvents.size > 0 && !(card.eventName && selectedEvents.has(card.eventName)))
          return false;
        if (q && !hay.includes(q)) return false;
        return true;
      })
      .map((s) => s.card);
  }, [searchable, query, selectedEvents]);

  return (
    <>
      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="relative flex-1 min-w-[200px] max-w-sm">
          <i
            className="ti ti-search absolute left-3 top-1/2 -translate-y-1/2 text-[15px] text-ink-3 pointer-events-none"
            aria-hidden="true"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search all fields…"
            autoComplete="off"
            aria-label="Search contacts"
            className="w-full pl-9 pr-8 py-2.5 rounded-xl border border-line bg-panel text-[13px] text-ink placeholder:text-ink-3 outline-none focus:border-ink transition-colors [&::-webkit-search-cancel-button]:hidden"
          />
          {query ? (
            <button
              type="button"
              onClick={() => setQuery('')}
              aria-label="Clear search"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 w-6 h-6 grid place-items-center rounded-full text-ink-3 hover:text-urgent"
            >
              <i className="ti ti-x text-[14px]" aria-hidden="true" />
            </button>
          ) : null}
        </div>

        <EventFilter events={events} selected={selectedEvents} onChange={setSelectedEvents} />

        <div className="ml-auto">
          <BusinessCardDialog mode="create" events={events} s3Configured={s3Configured} />
        </div>
      </div>

      {/* Active filter chips */}
      {selectedEvents.size > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5 mb-3">
          {[...selectedEvents].map((name) => (
            <button
              key={name}
              type="button"
              onClick={() =>
                setSelectedEvents((prev) => {
                  const next = new Set(prev);
                  next.delete(name);
                  return next;
                })
              }
              className="inline-flex items-center gap-1 px-2.5 py-1 rounded-pill text-[11px] font-medium bg-primary-soft text-primary border border-primary-line"
            >
              {name}
              <i className="ti ti-x text-[12px]" aria-hidden="true" />
            </button>
          ))}
          <button
            type="button"
            onClick={() => setSelectedEvents(new Set())}
            className="text-[11px] text-ink-3 hover:text-ink underline underline-offset-2 ml-1"
          >
            Clear
          </button>
        </div>
      ) : null}

      <section aria-label="Contacts">
        <div className="flex items-center justify-between mb-2">
          <h2 className="section-label">Contacts</h2>
          <span className="text-[11px] text-ink-3">
            {filtered.length} {filtered.length === 1 ? 'contact' : 'contacts'}
          </span>
        </div>

        {filtered.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line p-10 text-center bg-panel">
            <i className="ti ti-address-book-off text-[28px] text-ink-3 mb-2 block" aria-hidden="true" />
            <p className="text-[13px] text-ink-2">
              {cards.length === 0
                ? 'No contacts yet. Add the first business card.'
                : 'No contacts match your search or filters.'}
            </p>
          </div>
        ) : (
          <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2 md:gap-3">
            {filtered.map((c) => (
              <li key={c.id}>
                <BusinessCardInteractive card={c} />
              </li>
            ))}
          </ul>
        )}
      </section>
    </>
  );
}

/** Multi-select Event filter with its own quick-search box. */
function EventFilter({
  events,
  selected,
  onChange,
}: {
  events: BusinessCardEventDto[];
  selected: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const [open, setOpen] = useState(false);
  const [q, setQ] = useState('');
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    return needle ? events.filter((e) => e.name.toLowerCase().includes(needle)) : events;
  }, [events, q]);

  const toggle = (name: string) => {
    const next = new Set(selected);
    if (next.has(name)) next.delete(name);
    else next.add(name);
    onChange(next);
  };

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={cn(
          'inline-flex items-center gap-1.5 px-3 py-2 rounded-xl border text-[12px] font-medium transition-colors',
          selected.size > 0
            ? 'bg-primary-soft text-primary border-primary-line'
            : 'bg-panel text-ink-2 border-line hover:border-ink-4',
        )}
      >
        <i className="ti ti-calendar-event text-[14px]" aria-hidden="true" />
        Event
        {selected.size > 0 ? (
          <span className="ml-0.5 inline-grid place-items-center min-w-[18px] h-[18px] px-1 rounded-full bg-primary text-onink text-[10px]">
            {selected.size}
          </span>
        ) : null}
        <i className={cn('ti ti-chevron-down text-[13px] transition-transform', open && 'rotate-180')} aria-hidden="true" />
      </button>

      {open ? (
        <div className="absolute z-30 mt-1.5 w-64 max-h-80 flex flex-col rounded-xl border border-line bg-panel shadow-[0_8px_24px_-8px_rgba(0,0,0,0.25)] overflow-hidden">
          <div className="p-2 border-b border-line-2">
            <div className="relative">
              <i className="ti ti-search absolute left-2.5 top-1/2 -translate-y-1/2 text-[13px] text-ink-3" aria-hidden="true" />
              <input
                autoFocus
                value={q}
                onChange={(e) => setQ(e.target.value)}
                placeholder="Search events…"
                className="w-full pl-8 pr-2 py-1.5 rounded-lg border border-line bg-bg text-[12px] text-ink outline-none focus:border-ink"
              />
            </div>
          </div>
          <ul className="overflow-y-auto py-1">
            {shown.length === 0 ? (
              <li className="px-3 py-3 text-[12px] text-ink-3 text-center">No events found.</li>
            ) : (
              shown.map((e) => {
                const checked = selected.has(e.name);
                return (
                  <li key={e.id}>
                    <button
                      type="button"
                      onClick={() => toggle(e.name)}
                      className="w-full flex items-center gap-2 px-3 py-1.5 text-left text-[12px] text-ink hover:bg-line-2"
                    >
                      <span
                        className={cn(
                          'w-4 h-4 rounded border grid place-items-center shrink-0',
                          checked ? 'bg-primary border-primary text-onink' : 'border-line',
                        )}
                      >
                        {checked ? <i className="ti ti-check text-[11px]" aria-hidden="true" /> : null}
                      </span>
                      <span className="truncate">{e.name}</span>
                    </button>
                  </li>
                );
              })
            )}
          </ul>
          {selected.size > 0 ? (
            <div className="p-2 border-t border-line-2">
              <button
                type="button"
                onClick={() => onChange(new Set())}
                className="w-full py-1.5 rounded-lg text-[12px] font-medium text-ink-2 border border-line hover:bg-line-2"
              >
                Clear selection
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
