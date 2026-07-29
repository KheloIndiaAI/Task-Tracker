import { redirect } from 'next/navigation';

import { DocumentCardInteractive } from '@/components/ui/DocumentCardInteractive';
import { auth } from '@/lib/auth';
import {
  canAccessDocumentCentreById,
  fetchDocumentCounts,
  fetchVisibleDocuments,
} from '@/lib/document-centre';
import {
  DOC_FILTERS,
  DOC_SORTS,
  type DocFilter,
  type DocSort,
} from '@/lib/document-centre-shared';
import { isS3Configured } from '@/lib/s3';

import { CreateDocumentDialog } from './_components/CreateDocumentDialog';
import { DocumentFilterChips } from './_components/DocumentFilterChips';
import { DocumentQuickSearch } from './_components/DocumentQuickSearch';
import { DocumentSortControl } from './_components/DocumentSortControl';
import { DocumentStatsStrip } from './_components/DocumentStatsStrip';

type PageProps = {
  searchParams?: { filter?: string; sort?: string };
};

export default async function DocumentCentrePage({ searchParams }: PageProps) {
  const session = await auth();
  if (!session?.user) redirect('/login');
  // Executive-only. Unauthorized users never reach the module UI (the nav item
  // is also hidden); the APIs + server actions return a real 403. DB-backed so a
  // just-granted user gets in immediately, without waiting for a token refresh.
  if (!(await canAccessDocumentCentreById(session.user.id))) redirect('/tasks');

  const filter: DocFilter = DOC_FILTERS.includes((searchParams?.filter as DocFilter) ?? 'all')
    ? ((searchParams?.filter as DocFilter) ?? 'all')
    : 'all';
  const sort: DocSort = DOC_SORTS.includes((searchParams?.sort as DocSort) ?? 'modified')
    ? ((searchParams?.sort as DocSort) ?? 'modified')
    : 'modified';

  const [records, counts] = await Promise.all([
    fetchVisibleDocuments({ callerId: session.user.id, filter, sort }),
    fetchDocumentCounts(session.user.id),
  ]);

  // Everyone who reaches this page passed the Document Centre access gate above,
  // and every record action (review / awaiting input / status) re-checks that
  // same access server-side — so all viewers may run the long-press actions.
  const canActOnRecords = true;

  return (
    <div className="max-w-6xl mx-auto px-4 md:px-6 lg:px-8 pt-4 md:pt-6 pb-24 md:pb-10">
      <header className="mb-5">
        <div className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-[10px] uppercase tracking-[0.08em] text-ink-3 font-medium mb-1 inline-flex items-center gap-1">
              <i className="ti ti-files text-[11px] text-primary" aria-hidden="true" />
              Executive workspace
            </p>
            <h1 className="font-serif text-[22px] md:text-[28px] leading-tight text-ink">
              Document Centre
            </h1>
            <p className="mt-1.5 text-[12px] text-ink-2 max-w-2xl leading-relaxed">
              Confidential executive records — minutes, meeting documents, briefing notes,
              reports, presentations, and official correspondence.
            </p>
          </div>
          <CreateDocumentDialog s3Configured={isS3Configured()} />
        </div>
      </header>

      <div className="mb-4">
        <DocumentStatsStrip counts={counts} />
      </div>

      <div className="flex items-center justify-between gap-3 mb-1">
        <DocumentFilterChips active={filter} />
        <DocumentSortControl current={sort} />
      </div>

      <DocumentQuickSearch>
        <section aria-label="Records">
          <div className="flex items-center justify-between mb-2">
            <h2 className="section-label">Records</h2>
            <span className="text-[11px] text-ink-3">
              {records.length} {records.length === 1 ? 'item' : 'items'}
            </span>
          </div>

          {records.length === 0 ? (
            <EmptyState filter={filter} />
          ) : (
            <ul className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2 md:gap-3">
              {records.map((r) => (
                <li key={r.id}>
                  <DocumentCardInteractive
                    id={r.id}
                    subject={r.subject}
                    urgency={r.urgency}
                    status={r.status}
                    markedForReview={r.markedForReview}
                    awaitingInput={r.awaitingInput}
                    createdByName={r.createdBy.name}
                    createdAt={r.createdAt}
                    hasAttachment={r.hasAttachment}
                    href={`/document-centre/${r.id}`}
                    canAct={canActOnRecords}
                  />
                </li>
              ))}
            </ul>
          )}
        </section>
      </DocumentQuickSearch>
    </div>
  );
}

function EmptyState({ filter }: { filter: DocFilter }) {
  const copy: Record<DocFilter, string> = {
    all: 'No records yet. Create the first executive record.',
    under_review: 'No records are under review.',
    awaiting_input: 'No records are awaiting input.',
    highly_urgent: 'No highly urgent records.',
    completed: 'No completed records.',
  };
  return (
    <div className="rounded-xl border border-dashed border-line p-10 text-center bg-panel">
      <i className="ti ti-files text-[28px] text-ink-3 mb-2 block" aria-hidden="true" />
      <p className="text-[13px] text-ink-2">{copy[filter]}</p>
    </div>
  );
}
