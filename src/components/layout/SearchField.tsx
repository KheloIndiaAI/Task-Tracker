'use client';

import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import Link from 'next/link';
import { useRouter } from 'next/navigation';

import type {
  SearchResults,
  SearchTaskResult,
  SearchTfResult,
  SearchUserResult,
  SearchTagResult,
  SearchDocumentResult,
} from '@/lib/search';
import { cn } from '@/lib/utils';

import { UserProfilePopup } from './UserProfilePopup';

const DEBOUNCE_MS = 200;
const MIN_LENGTH = 2;

const EMPTY: SearchResults = {
  query: '',
  tasks: [],
  timelineFiles: [],
  users: [],
  tags: [],
  documents: [],
  totals: { tasks: 0, timelineFiles: 0, users: 0, tags: 0, documents: 0 },
};

export function SearchField() {
  const router = useRouter();
  const wrapRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const mobileInputRef = useRef<HTMLInputElement>(null);

  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [results, setResults] = useState<SearchResults>(EMPTY);
  const [activeIndex, setActiveIndex] = useState(0);
  // The person whose view-only profile popup is open (from a People result).
  const [profileUserId, setProfileUserId] = useState<string | null>(null);

  // Debounce the query
  useEffect(() => {
    const t = setTimeout(() => setDebounced(query.trim()), DEBOUNCE_MS);
    return () => clearTimeout(t);
  }, [query]);

  // Fetch on debounced query
  useEffect(() => {
    if (debounced.length < MIN_LENGTH) {
      setResults(EMPTY);
      setLoading(false);
      return;
    }
    const ctl = new AbortController();
    setLoading(true);
    fetch(`/api/search?q=${encodeURIComponent(debounced)}`, {
      signal: ctl.signal,
      cache: 'no-store',
    })
      .then((r) => r.json())
      .then((data: SearchResults) => {
        setResults(data);
        setLoading(false);
      })
      .catch((err) => {
        if (err.name !== 'AbortError') {
          console.error('Search failed:', err);
          setLoading(false);
        }
      });
    return () => ctl.abort();
  }, [debounced]);

  // Close desktop dropdown on outside click + Esc
  useEffect(() => {
    if (!open) return;
    const onClick = (e: MouseEvent) => {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) {
        setOpen(false);
      }
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setOpen(false);
        inputRef.current?.blur();
      }
    };
    window.addEventListener('mousedown', onClick);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('mousedown', onClick);
      window.removeEventListener('keydown', onKey);
    };
  }, [open]);

  // Mobile overlay: lock scroll, focus input, close on Esc
  useEffect(() => {
    if (!mobileOpen) return;
    document.body.style.overflow = 'hidden';
    setTimeout(() => mobileInputRef.current?.focus(), 50);
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') closeMobile();
    };
    window.addEventListener('keydown', onKey);
    return () => {
      document.body.style.overflow = '';
      window.removeEventListener('keydown', onKey);
    };
  }, [mobileOpen]);

  // Reset active highlight when results change
  useEffect(() => {
    setActiveIndex(0);
  }, [results.query]);

  const flat = [
    ...results.tasks.map((r) => ({ ...r, kind: 'task' as const })),
    ...results.timelineFiles.map((r) => ({ ...r, kind: 'tf' as const })),
    ...results.users.map((r) => ({ ...r, kind: 'user' as const })),
    ...results.tags.map((r) => ({ ...r, kind: 'tag' as const })),
    ...results.documents.map((r) => ({ ...r, kind: 'document' as const })),
  ];
  const totalShown = flat.length;
  const totalAll =
    results.totals.tasks +
    results.totals.timelineFiles +
    results.totals.users +
    results.totals.tags +
    results.totals.documents;

  const goToResultsPage = (q?: string) => {
    const value = (q ?? query).trim();
    if (value.length < MIN_LENGTH) return;
    setOpen(false);
    closeMobile();
    router.push(`/search?q=${encodeURIComponent(value)}`);
  };

  const navigateToResult = (href: string) => {
    setOpen(false);
    closeMobile();
    router.push(href);
  };

  // People results open a view-only profile popup rather than navigating.
  const openProfile = (userId: string) => {
    setOpen(false);
    closeMobile();
    setProfileUserId(userId);
  };

  const closeMobile = () => {
    setMobileOpen(false);
    setQuery('');
    setResults(EMPTY);
  };

  const onKeyDown = (e: React.KeyboardEvent<HTMLInputElement>) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      if (totalShown > 0) {
        const item = flat[activeIndex];
        if (item) {
          if (item.kind === 'user') openProfile(item.id);
          else navigateToResult(item.href);
          return;
        }
      }
      goToResultsPage();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setActiveIndex((i) => (totalShown > 0 ? (i + 1) % totalShown : 0));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setActiveIndex((i) =>
        totalShown > 0 ? (i - 1 + totalShown) % totalShown : 0,
      );
    }
  };

  const isQuerying = query.trim().length >= MIN_LENGTH;
  const showDropdown = open && isQuerying;

  return (
    <>
      {/* ---- Mobile trigger button ---- */}
      <button
        type="button"
        onClick={() => setMobileOpen(true)}
        className="md:hidden inline-flex items-center gap-1.5 px-3 py-1.5 rounded-lg border border-line bg-bg text-[12px] text-ink-3"
      >
        <i className="ti ti-search text-[14px]" aria-hidden="true" />
        <span>Search</span>
      </button>

      {/* ---- Desktop inline input ---- */}
      <div
        className="hidden md:flex relative flex-1 max-w-[340px] lg:max-w-[380px]"
        ref={wrapRef}
      >
        <i
          className="ti ti-search absolute left-3 top-1/2 -translate-y-1/2 text-[14px] text-ink-3 pointer-events-none"
          aria-hidden="true"
        />
        <input
          ref={inputRef}
          type="search"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
          onKeyDown={onKeyDown}
          placeholder="Search tasks, files, documents, people…"
          className="w-full pl-9 pr-3 py-2 rounded-lg border border-line bg-bg text-[13px] text-ink placeholder:text-ink-3 outline-none focus:border-ink"
          aria-label="Global search"
          aria-expanded={showDropdown}
          aria-controls="search-dropdown"
          role="combobox"
          autoComplete="off"
        />

        {showDropdown ? (
          <div
            id="search-dropdown"
            role="listbox"
            className="absolute left-0 right-0 top-full mt-2 w-[440px] max-w-[calc(100vw-32px)] rounded-xl border border-line bg-panel shadow-xl z-40 overflow-hidden"
          >
            <div className="max-h-[60dvh] overflow-y-auto">
              {loading && totalShown === 0 ? (
                <p className="px-4 py-6 text-center text-[12px] text-ink-3">
                  Searching…
                </p>
              ) : totalShown === 0 ? (
                <p className="px-4 py-6 text-center text-[12px] text-ink-2">
                  No matches for &ldquo;{debounced}&rdquo;.
                </p>
              ) : (
                <DropdownGroups
                  results={results}
                  activeIndex={activeIndex}
                  onSelect={(href) => navigateToResult(href)}
                  onSelectUser={openProfile}
                  onHoverIndex={setActiveIndex}
                />
              )}
            </div>
            {isQuerying ? (
              <button
                type="button"
                onClick={() => goToResultsPage()}
                className="block w-full px-3 py-2.5 border-t border-line-2 bg-bg text-center text-[12px] font-medium text-primary hover:bg-primary-soft transition-colors"
              >
                {totalAll > totalShown
                  ? `See all ${totalAll} results for "${debounced}" →`
                  : `See full results for "${debounced}" →`}
              </button>
            ) : null}
          </div>
        ) : null}
      </div>

      {/* ---- Mobile full-screen overlay (portaled to body to escape header stacking context) ---- */}
      {mobileOpen
        ? createPortal(
            <div className="fixed inset-0 z-50 bg-bg flex flex-col md:hidden">
              {/* Header bar with close + input */}
              <div className="flex items-center gap-3 px-4 py-3 border-b border-line-2 shrink-0">
                <button
                  type="button"
                  onClick={closeMobile}
                  aria-label="Close search"
                  className="w-9 h-9 grid place-items-center rounded-full text-ink-2 hover:bg-line-2 shrink-0"
                >
                  <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <path d="M5 12h14" /><path d="M5 12l6-6" /><path d="M5 12l6 6" />
                  </svg>
                </button>
                <div className="relative flex-1">
                  <svg className="absolute left-3 top-1/2 -translate-y-1/2 text-ink-3 pointer-events-none" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                    <circle cx="11" cy="11" r="8" /><path d="M21 21l-4.35-4.35" />
                  </svg>
                  <input
                    ref={mobileInputRef}
                    type="search"
                    value={query}
                    onChange={(e) => setQuery(e.target.value)}
                    onKeyDown={onKeyDown}
                    placeholder="Search tasks, files, documents, people…"
                    className="w-full pl-10 pr-3 py-2.5 rounded-xl border border-line bg-panel text-[14px] text-ink placeholder:text-ink-3 outline-none focus:border-ink"
                    aria-label="Search"
                    autoComplete="off"
                  />
                </div>
              </div>

              {/* Results area */}
              <div className="flex-1 overflow-y-auto">
                {!isQuerying ? (
                  <p className="px-4 py-8 text-center text-[13px] text-ink-3">
                    Type at least two characters to search.
                  </p>
                ) : loading && totalShown === 0 ? (
                  <p className="px-4 py-8 text-center text-[13px] text-ink-3">
                    Searching…
                  </p>
                ) : isQuerying && totalShown === 0 && !loading ? (
                  <p className="px-4 py-8 text-center text-[13px] text-ink-2">
                    No matches for &ldquo;{debounced}&rdquo;.
                  </p>
                ) : (
                  <>
                    <DropdownGroups
                      results={results}
                      activeIndex={activeIndex}
                      onSelect={(href) => navigateToResult(href)}
                      onSelectUser={openProfile}
                      onHoverIndex={setActiveIndex}
                    />
                    {isQuerying ? (
                      <button
                        type="button"
                        onClick={() => goToResultsPage()}
                        className="block w-full px-3 py-3 border-t border-line-2 bg-bg text-center text-[13px] font-medium text-primary"
                      >
                        See full results for &ldquo;{debounced}&rdquo; →
                      </button>
                    ) : null}
                  </>
                )}
              </div>
            </div>,
            document.body,
          )
        : null}

      {/* View-only profile popup — opened from a People result */}
      <UserProfilePopup userId={profileUserId} onClose={() => setProfileUserId(null)} />
    </>
  );
}

// ------------------------------------------------------------
// Dropdown groups
// ------------------------------------------------------------

function DropdownGroups({
  results,
  activeIndex,
  onSelect,
  onSelectUser,
  onHoverIndex,
}: {
  results: SearchResults;
  activeIndex: number;
  onSelect: (href: string) => void;
  onSelectUser: (userId: string) => void;
  onHoverIndex: (i: number) => void;
}) {
  let runningIndex = 0;

  const taskCount = results.tasks.length;
  const tfCount = results.timelineFiles.length;
  const userCount = results.users.length;
  const tagCount = results.tags.length;
  const docCount = results.documents.length;

  return (
    <>
      {taskCount > 0 ? (
        <Group label="Tasks" count={results.totals.tasks}>
          {results.tasks.map((r) => {
            const idx = runningIndex++;
            return (
              <TaskRow
                key={r.id}
                row={r}
                active={idx === activeIndex}
                onMouseEnter={() => onHoverIndex(idx)}
                onSelect={() => onSelect(r.href)}
              />
            );
          })}
        </Group>
      ) : null}

      {tfCount > 0 ? (
        <Group label="Timeline files" count={results.totals.timelineFiles}>
          {results.timelineFiles.map((r) => {
            const idx = runningIndex++;
            return (
              <TfRow
                key={r.id}
                row={r}
                active={idx === activeIndex}
                onMouseEnter={() => onHoverIndex(idx)}
                onSelect={() => onSelect(r.href)}
              />
            );
          })}
        </Group>
      ) : null}

      {userCount > 0 ? (
        <Group label="People" count={results.totals.users}>
          {results.users.map((r) => {
            const idx = runningIndex++;
            return (
              <UserRow
                key={r.id}
                row={r}
                active={idx === activeIndex}
                onMouseEnter={() => onHoverIndex(idx)}
                onSelect={() => onSelectUser(r.id)}
              />
            );
          })}
        </Group>
      ) : null}

      {tagCount > 0 ? (
        <Group label="Tags" count={results.totals.tags}>
          {results.tags.map((r) => {
            const idx = runningIndex++;
            return (
              <TagRow
                key={r.id}
                row={r}
                active={idx === activeIndex}
                onMouseEnter={() => onHoverIndex(idx)}
                onSelect={() => onSelect(r.href)}
              />
            );
          })}
        </Group>
      ) : null}

      {docCount > 0 ? (
        <Group label="Documents" count={results.totals.documents}>
          {results.documents.map((r) => {
            const idx = runningIndex++;
            return (
              <DocRow
                key={r.id}
                row={r}
                active={idx === activeIndex}
                onMouseEnter={() => onHoverIndex(idx)}
                onSelect={() => onSelect(r.href)}
              />
            );
          })}
        </Group>
      ) : null}
    </>
  );
}

function Group({
  label,
  count,
  children,
}: {
  label: string;
  count: number;
  children: React.ReactNode;
}) {
  return (
    <section className="border-b border-line-2 last:border-b-0">
      <header className="px-3 pt-2.5 pb-1 flex items-center justify-between gap-2 bg-bg/60">
        <h3 className="text-[9px] uppercase tracking-[0.08em] font-medium text-ink-3">
          {label}
        </h3>
        <span className="text-[10px] text-ink-3">{count}</span>
      </header>
      <ul>{children}</ul>
    </section>
  );
}

// ------------------------------------------------------------
// Rows
// ------------------------------------------------------------

const STATUS_LABEL: Record<string, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  awaiting_input: 'Awaiting input',
  on_hold: 'On hold',
  completed: 'Completed',
  pending_action: 'Pending action',
  awaiting_reply: 'Awaiting reply',
  closed: 'Closed',
};

function RowLink({
  href,
  active,
  onMouseEnter,
  onSelect,
  children,
}: {
  href: string;
  active: boolean;
  onMouseEnter: () => void;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <li>
      <Link
        href={href}
        role="option"
        aria-selected={active}
        onMouseEnter={onMouseEnter}
        onMouseDown={(e) => {
          e.preventDefault();
        }}
        onClick={onSelect}
        className={cn(
          'flex items-center gap-2.5 px-3 py-2 transition-colors',
          active ? 'bg-primary-soft' : 'hover:bg-bg',
        )}
      >
        {children}
      </Link>
    </li>
  );
}

function RowButton({
  active,
  onMouseEnter,
  onSelect,
  children,
}: {
  active: boolean;
  onMouseEnter: () => void;
  onSelect: () => void;
  children: React.ReactNode;
}) {
  return (
    <li>
      <button
        type="button"
        role="option"
        aria-selected={active}
        onMouseEnter={onMouseEnter}
        onMouseDown={(e) => e.preventDefault()}
        onClick={onSelect}
        className={cn(
          'w-full flex items-center gap-2.5 px-3 py-2 text-left transition-colors',
          active ? 'bg-primary-soft' : 'hover:bg-bg',
        )}
      >
        {children}
      </button>
    </li>
  );
}

function TaskRow({
  row,
  active,
  onMouseEnter,
  onSelect,
}: {
  row: SearchTaskResult;
  active: boolean;
  onMouseEnter: () => void;
  onSelect: () => void;
}) {
  return (
    <RowLink href={row.href} active={active} onMouseEnter={onMouseEnter} onSelect={onSelect}>
      <span
        className="w-7 h-7 grid place-items-center rounded-md text-white text-[10px] font-medium shrink-0"
        style={{ backgroundColor: row.divisionColour }}
        aria-hidden="true"
      >
        {row.ownerInitials}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-[12.5px] font-medium text-ink truncate">
          {row.name}
        </span>
        <span className="block text-[10.5px] text-ink-3 truncate">
          {row.divisionName} · {row.ownerName} · {STATUS_LABEL[row.status] ?? row.status}
        </span>
      </span>
    </RowLink>
  );
}

function DocRow({
  row,
  active,
  onMouseEnter,
  onSelect,
}: {
  row: SearchDocumentResult;
  active: boolean;
  onMouseEnter: () => void;
  onSelect: () => void;
}) {
  return (
    <RowLink href={row.href} active={active} onMouseEnter={onMouseEnter} onSelect={onSelect}>
      <span
        className="w-7 h-7 grid place-items-center rounded-md bg-primary-soft text-primary shrink-0"
        aria-hidden="true"
      >
        <i className="ti ti-files text-[14px]" aria-hidden="true" />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-[12.5px] font-medium text-ink truncate">{row.subject}</span>
        <span className="block text-[10.5px] text-ink-3 truncate">
          Document Centre · {row.createdByName}
        </span>
      </span>
    </RowLink>
  );
}

function TfRow({
  row,
  active,
  onMouseEnter,
  onSelect,
}: {
  row: SearchTfResult;
  active: boolean;
  onMouseEnter: () => void;
  onSelect: () => void;
}) {
  return (
    <RowLink href={row.href} active={active} onMouseEnter={onMouseEnter} onSelect={onSelect}>
      <span
        className="w-7 h-7 grid place-items-center rounded-md bg-primary text-onink shrink-0"
        aria-hidden="true"
      >
        <i className="ti ti-file-stack text-[14px]" aria-hidden="true" />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-[12.5px] font-medium text-ink truncate">
          <span className="font-mono mr-1.5 text-primary">{row.refNo}</span>
          {row.subject}
        </span>
        <span className="block text-[10.5px] text-ink-3 truncate">
          From {row.fromWhom} · {STATUS_LABEL[row.status] ?? row.status}
        </span>
      </span>
    </RowLink>
  );
}

function UserRow({
  row,
  active,
  onMouseEnter,
  onSelect,
}: {
  row: SearchUserResult;
  active: boolean;
  onMouseEnter: () => void;
  onSelect: () => void;
}) {
  return (
    <RowButton active={active} onMouseEnter={onMouseEnter} onSelect={onSelect}>
      <span
        className="w-7 h-7 grid place-items-center rounded-full text-white text-[10px] font-medium shrink-0"
        style={{ backgroundColor: row.divisionColour }}
        aria-hidden="true"
      >
        {initialsOf(row.name)}
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-[12.5px] font-medium text-ink truncate">
          {row.name}{' '}
          <span className="font-mono text-[10.5px] text-ink-3 font-normal">
            @{row.username}
          </span>
          {!row.isActive ? (
            <span className="ml-1.5 inline-flex items-center text-[9px] uppercase tracking-[0.06em] font-medium text-low bg-low-soft border border-line px-1 py-0.5 rounded">
              Disabled
            </span>
          ) : null}
        </span>
        <span className="block text-[10.5px] text-ink-3 truncate">
          {row.designation}
        </span>
      </span>
      {/* Hints that selecting opens a profile card rather than navigating. */}
      <i
        className="ti ti-id-badge-2 text-[15px] text-ink-3 shrink-0"
        aria-hidden="true"
      />
    </RowButton>
  );
}

function TagRow({
  row,
  active,
  onMouseEnter,
  onSelect,
}: {
  row: SearchTagResult;
  active: boolean;
  onMouseEnter: () => void;
  onSelect: () => void;
}) {
  return (
    <RowLink href={row.href} active={active} onMouseEnter={onMouseEnter} onSelect={onSelect}>
      <span
        className="w-7 h-7 grid place-items-center rounded-md bg-line-2 text-ink-2 shrink-0"
        aria-hidden="true"
      >
        <i className="ti ti-tag text-[14px]" aria-hidden="true" />
      </span>
      <span className="flex-1 min-w-0">
        <span className="block text-[12.5px] font-medium text-ink truncate">
          {row.name}
        </span>
        <span className="block text-[10.5px] text-ink-3 truncate">
          {row.taskCount} {row.taskCount === 1 ? 'task' : 'tasks'}
        </span>
      </span>
    </RowLink>
  );
}

// ------------------------------------------------------------
// Internal helpers
// ------------------------------------------------------------

function initialsOf(name: string): string {
  const parts = name.replace(/[().]/g, '').split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return ((parts[0][0] ?? '') + (parts[parts.length - 1][0] ?? '')).toUpperCase();
}
