import Link from 'next/link';
import { Suspense } from 'react';
import { redirect } from 'next/navigation';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { canAccessDocumentCentreById } from '@/lib/document-centre';
import {
  isQuerySearchable,
  searchFull,
  type SearchResults,
  type SearchTaskFilters,
  type SearchType,
} from '@/lib/search';
import { cn } from '@/lib/utils';
import { SearchAdvancedFilters } from './_components/SearchAdvancedFilters';
import { SearchInput } from './_components/SearchInput';

type PageProps = {
  searchParams?: {
    q?: string;
    type?: string;
    status?: string;
    priority?: string;
    division?: string;
    dueFrom?: string;
    dueTo?: string;
    jsP?: string;
    tag?: string;
  };
};

const TYPES: { id: SearchType; label: string }[] = [
  { id: 'all', label: 'All' },
  { id: 'tasks', label: 'Tasks' },
  { id: 'timeline_files', label: 'Timeline files' },
  { id: 'users', label: 'People' },
  { id: 'tags', label: 'Tags' },
  { id: 'documents', label: 'Documents' },
];

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

export default async function SearchPage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user) redirect('/login');

  const rawQuery = (searchParams?.q ?? '').trim();
  // Tags are a Super Admin-only feature — non-admins never get the tag tab
  // or tag results (also enforced in the search library).
  const isSuperAdmin = session.user.isSuperAdmin;
  // Document Centre records are gated the same way the module is, so the tab
  // only exists for a caller who holds access (the search library withholds
  // the rows regardless).
  const canDocs = await canAccessDocumentCentreById(session.user.id);
  let type: SearchType = isType(searchParams?.type) ? searchParams!.type : 'all';
  if (type === 'tags' && !isSuperAdmin) type = 'all';
  if (type === 'documents' && !canDocs) type = 'all';
  const visibleTypes = TYPES.filter(
    (t) => (t.id !== 'tags' || isSuperAdmin) && (t.id !== 'documents' || canDocs),
  );

  const taskFilters: SearchTaskFilters = {};
  if (searchParams?.status) taskFilters.status = searchParams.status;
  if (searchParams?.priority) taskFilters.priority = searchParams.priority;
  if (searchParams?.division) taskFilters.divisionId = searchParams.division;
  if (searchParams?.dueFrom) taskFilters.dueFrom = searchParams.dueFrom;
  if (searchParams?.dueTo) taskFilters.dueTo = searchParams.dueTo;
  if (searchParams?.jsP === '1') taskFilters.jsPriority = true;
  if (searchParams?.tag) taskFilters.tagId = searchParams.tag;

  const showTaskFilters = type === 'all' || type === 'tasks';

  const [results, divisions] = await Promise.all([
    isQuerySearchable(rawQuery)
      ? searchFull(session.user.id, rawQuery, type, taskFilters)
      : Promise.resolve({
          query: rawQuery,
          tasks: [] as SearchResults['tasks'],
          timelineFiles: [] as SearchResults['timelineFiles'],
          users: [] as SearchResults['users'],
          tags: [] as SearchResults['tags'],
          documents: [] as SearchResults['documents'],
          totals: { tasks: 0, timelineFiles: 0, users: 0, tags: 0, documents: 0 },
        } as SearchResults),
    showTaskFilters
      ? prisma.division.findMany({
          where: { kind: 'division' },
          select: { id: true, name: true },
          orderBy: { displayOrder: 'asc' },
        })
      : Promise.resolve([]),
  ]);

  const grandTotal =
    results.totals.tasks +
    results.totals.timelineFiles +
    results.totals.users +
    results.totals.tags +
    results.totals.documents;

  return (
    <div className="max-w-5xl mx-auto px-4 md:px-6 lg:px-8 pt-4 md:pt-6 pb-12">
      <header className="mb-5">
        <p className="text-[10px] uppercase tracking-[0.08em] text-ink-3 font-medium mb-1 inline-flex items-center gap-1">
          <i
            className="ti ti-search text-[11px] text-primary"
            aria-hidden="true"
          />
          Search
        </p>
        <h1 className="font-serif text-[22px] md:text-[28px] leading-tight text-ink">
          {rawQuery ? <>Results for &ldquo;{rawQuery}&rdquo;</> : 'Search'}
        </h1>

        {/* Search input — always visible on this page (mobile has no header input) */}
        <SearchInput defaultValue={rawQuery} />

        <p className="mt-3 text-[12px] text-ink-2">
          {!isQuerySearchable(rawQuery)
            ? 'Type at least two characters and press enter.'
            : `${grandTotal} ${grandTotal === 1 ? 'match' : 'matches'}.`}
        </p>
      </header>

      {/* Type filter chips */}
      <nav
        aria-label="Filter results by type"
        className="flex gap-1.5 flex-wrap mb-5"
      >
        {visibleTypes.map((t) => {
          const active = t.id === type;
          const sp = new URLSearchParams();
          sp.set('q', rawQuery);
          if (t.id !== 'all') sp.set('type', t.id);
          const totals = totalForType(results.totals, t.id);
          return (
            <Link
              key={t.id}
              href={`/search?${sp.toString()}`}
              scroll={false}
              aria-current={active ? 'page' : undefined}
              className={cn(
                'whitespace-nowrap px-3 py-1.5 rounded-[14px] text-[12px] font-medium border transition-colors inline-flex items-center gap-1.5',
                active
                  ? 'bg-ink text-onink border-ink'
                  : 'bg-panel text-ink-2 border-line hover:border-ink-4',
              )}
            >
              {t.label}
              <span
                className={cn(
                  'text-[10px] font-medium',
                  active ? 'text-onink/80' : 'text-ink-3',
                )}
              >
                {totals}
              </span>
            </Link>
          );
        })}
      </nav>

      {/* Advanced task filters */}
      {showTaskFilters && isQuerySearchable(rawQuery) ? (
        <Suspense fallback={null}>
          <SearchAdvancedFilters divisions={divisions} />
        </Suspense>
      ) : null}

      {/* Result groups */}
      {!isQuerySearchable(rawQuery) ? null : grandTotal === 0 ? (
        <EmptyState query={rawQuery} />
      ) : (
        <div className="flex flex-col gap-6">
          {(type === 'all' || type === 'tasks') && results.tasks.length > 0 ? (
            <Group label="Tasks" total={results.totals.tasks} shown={results.tasks.length}>
              {results.tasks.map((r) => (
                <Link
                  key={r.id}
                  href={r.href}
                  className="flex items-start gap-3 p-3.5 bg-panel border border-line rounded-xl hover:border-ink-4 transition-colors"
                >
                  <span
                    className="w-9 h-9 grid place-items-center rounded-md text-white text-[11px] font-medium shrink-0"
                    style={{ backgroundColor: r.divisionColour }}
                    aria-hidden="true"
                  >
                    {r.ownerInitials}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[13.5px] font-medium text-ink truncate">
                      {r.name}
                    </p>
                    <p className="text-[11px] text-ink-3 truncate mt-0.5">
                      {r.divisionName} · {r.ownerName} ·{' '}
                      {STATUS_LABEL[r.status] ?? r.status}
                    </p>
                  </div>
                </Link>
              ))}
            </Group>
          ) : null}

          {(type === 'all' || type === 'timeline_files') &&
          results.timelineFiles.length > 0 ? (
            <Group
              label="Timeline files"
              total={results.totals.timelineFiles}
              shown={results.timelineFiles.length}
            >
              {results.timelineFiles.map((r) => (
                <Link
                  key={r.id}
                  href={r.href}
                  className="flex items-start gap-3 p-3.5 bg-panel border border-line rounded-xl hover:border-ink-4 transition-colors"
                >
                  <span
                    className="w-9 h-9 grid place-items-center rounded-md bg-primary text-onink shrink-0"
                    aria-hidden="true"
                  >
                    <i className="ti ti-file-stack text-[16px]" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[13.5px] font-medium text-ink truncate">
                      <span className="font-mono mr-1.5 text-primary">{r.refNo}</span>
                      {r.subject}
                    </p>
                    <p className="text-[11px] text-ink-3 truncate mt-0.5">
                      From {r.fromWhom} · {STATUS_LABEL[r.status] ?? r.status}
                    </p>
                  </div>
                </Link>
              ))}
            </Group>
          ) : null}

          {(type === 'all' || type === 'users') && results.users.length > 0 ? (
            <Group label="People" total={results.totals.users} shown={results.users.length}>
              {results.users.map((r) => (
                <Link
                  key={r.id}
                  href={r.href}
                  className="flex items-start gap-3 p-3.5 bg-panel border border-line rounded-xl hover:border-ink-4 transition-colors"
                >
                  <span
                    className="w-9 h-9 grid place-items-center rounded-full text-white text-[11px] font-medium shrink-0"
                    style={{ backgroundColor: r.divisionColour }}
                    aria-hidden="true"
                  >
                    {initialsOf(r.name)}
                  </span>
                  <div className="min-w-0">
                    <p className="text-[13.5px] font-medium text-ink truncate inline-flex items-baseline gap-1.5">
                      {r.name}
                      <span className="font-mono text-[11px] text-ink-3 font-normal">
                        @{r.username}
                      </span>
                      {!r.isActive ? (
                        <span className="text-[9px] uppercase tracking-[0.06em] font-medium text-low bg-low-soft border border-line px-1 py-0.5 rounded">
                          Disabled
                        </span>
                      ) : null}
                    </p>
                    <p className="text-[11px] text-ink-3 truncate mt-0.5">
                      {r.designation}
                    </p>
                  </div>
                </Link>
              ))}
            </Group>
          ) : null}

          {(type === 'all' || type === 'documents') && results.documents.length > 0 ? (
            <Group
              label="Documents"
              total={results.totals.documents}
              shown={results.documents.length}
            >
              {results.documents.map((r) => (
                <Link
                  key={r.id}
                  href={r.href}
                  className="flex items-center gap-3 p-3.5 bg-panel border border-line rounded-xl hover:border-ink-4 transition-colors"
                >
                  <span className="w-9 h-9 grid place-items-center rounded-md bg-primary-soft text-primary shrink-0">
                    <i className="ti ti-files text-[16px]" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[13.5px] font-medium text-ink truncate">{r.subject}</p>
                    <p className="text-[11px] text-ink-3 truncate mt-0.5">
                      Document Centre · {r.createdByName}
                    </p>
                  </div>
                </Link>
              ))}
            </Group>
          ) : null}

          {(type === 'all' || type === 'tags') && results.tags.length > 0 ? (
            <Group label="Tags" total={results.totals.tags} shown={results.tags.length}>
              {results.tags.map((r) => (
                <Link
                  key={r.id}
                  href={r.href}
                  className="flex items-center gap-3 p-3.5 bg-panel border border-line rounded-xl hover:border-ink-4 transition-colors"
                >
                  <span className="w-9 h-9 grid place-items-center rounded-md bg-line-2 text-ink-2 shrink-0">
                    <i className="ti ti-tag text-[16px]" aria-hidden="true" />
                  </span>
                  <div className="min-w-0">
                    <p className="text-[13.5px] font-medium text-ink truncate">
                      {r.name}
                    </p>
                    <p className="text-[11px] text-ink-3 truncate mt-0.5">
                      {r.taskCount} {r.taskCount === 1 ? 'task' : 'tasks'}
                    </p>
                  </div>
                </Link>
              ))}
            </Group>
          ) : null}
        </div>
      )}
    </div>
  );
}

function Group({
  label,
  total,
  shown,
  children,
}: {
  label: string;
  total: number;
  shown: number;
  children: React.ReactNode;
}) {
  return (
    <section>
      <header className="flex items-baseline justify-between mb-2">
        <h2 className="section-label">{label}</h2>
        <span className="text-[11px] text-ink-3">
          {shown < total ? `${shown} of ${total}` : total}
        </span>
      </header>
      <ul className="flex flex-col gap-2">{children}</ul>
    </section>
  );
}

function EmptyState({ query }: { query: string }) {
  return (
    <div className="rounded-xl border border-dashed border-line bg-panel p-12 text-center">
      <i
        className="ti ti-search-off text-[32px] text-ink-3 block mb-2"
        aria-hidden="true"
      />
      <h2 className="font-serif text-[18px] text-ink mb-1">No matches found</h2>
      <p className="text-[13px] text-ink-2 max-w-md mx-auto">
        Nothing in tasks, timeline files, documents, people, or tags matched
        &ldquo;{query}&rdquo;.
      </p>
    </div>
  );
}

// ------------------------------------------------------------
// Helpers
// ------------------------------------------------------------

function isType(v: string | undefined): v is SearchType {
  if (!v) return false;
  return ['all', 'tasks', 'timeline_files', 'users', 'tags', 'documents'].includes(v);
}

function totalForType(
  totals: {
    tasks: number;
    timelineFiles: number;
    users: number;
    tags: number;
    documents: number;
  },
  t: SearchType,
): number {
  switch (t) {
    case 'tasks':
      return totals.tasks;
    case 'timeline_files':
      return totals.timelineFiles;
    case 'users':
      return totals.users;
    case 'tags':
      return totals.tags;
    case 'documents':
      return totals.documents;
    case 'all':
    default:
      return (
        totals.tasks + totals.timelineFiles + totals.users + totals.tags + totals.documents
      );
  }
}

function initialsOf(name: string): string {
  const parts = name.replace(/[().]/g, '').split(/\s+/).filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return ((parts[0][0] ?? '') + (parts[parts.length - 1][0] ?? '')).toUpperCase();
}
