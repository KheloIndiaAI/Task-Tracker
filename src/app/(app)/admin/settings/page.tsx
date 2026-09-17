import { prisma } from '@/lib/db';

import { CutoverCard } from './_components/CutoverCard';

export default async function AdminSettingsPage() {
  const [
    userCount,
    activeUserCount,
    divisionCount,
    taskCount,
    tfCount,
    tagCount,
    auditCount,
    cutoverEvent,
  ] = await Promise.all([
    prisma.user.count(),
    prisma.user.count({ where: { isActive: true } }),
    prisma.division.count(),
    prisma.task.count({ where: { archivedAt: null } }),
    prisma.timelineFile.count({ where: { archivedAt: null } }),
    prisma.tag.count(),
    prisma.auditLog.count(),
    prisma.auditLog.findFirst({
      where: {
        entityType: 'system',
        // Detect any cutover marker that's already been written.
        after: { path: ['event'], equals: 'operational_cutover' },
      },
      orderBy: { createdAt: 'desc' },
    }),
  ]);

  const isOperational = !!cutoverEvent;

  return (
    <div className="max-w-3xl mx-auto flex flex-col gap-5">
      <header>
        <h2 className="font-serif text-[22px] md:text-[26px] leading-tight text-ink">
          Settings
        </h2>
        <p className="text-[12px] text-ink-3 mt-1">
          App-level configuration. Most rows are read-only for now — editable
          settings land later in Phase 4 polish.
        </p>
      </header>

      {/* About */}
      <section className="bg-panel border border-line rounded-2xl overflow-hidden">
        <header className="px-5 pt-5 pb-3 border-b border-line-2">
          <p className="text-[10px] uppercase tracking-[0.08em] font-medium text-ink-3 mb-1">
            About this installation
          </p>
          <h2 className="font-serif text-[18px] md:text-[20px] leading-tight text-ink">
            MYAS Task Tracker
          </h2>
          <p className="text-[12px] text-ink-2 mt-1">
            Ministry of Youth Affairs &amp; Sports, Government of India · Asia/Kolkata
          </p>
        </header>
        <dl className="px-2 py-2">
          <Row label="Mode">
            <span
              className={isOperational ? 'text-success font-medium' : 'text-accent font-medium'}
            >
              {isOperational ? 'Operational' : 'Testing (mock data may be present)'}
            </span>
          </Row>
          <Row label="Total users">
            <span>
              {userCount} · <span className="text-ink-3 font-normal">{activeUserCount} active</span>
            </span>
          </Row>
          <Row label="Divisions">{divisionCount}</Row>
          <Row label="Open tasks">{taskCount}</Row>
          <Row label="Timeline files">{tfCount}</Row>
          <Row label="Tags">{tagCount}</Row>
          <Row label="Audit entries">{auditCount}</Row>
        </dl>
      </section>

      {/* Display preferences */}
      <section className="bg-panel border border-line rounded-2xl overflow-hidden">
        <header className="px-5 pt-5 pb-3 border-b border-line-2">
          <p className="text-[10px] uppercase tracking-[0.08em] font-medium text-ink-3 mb-1">
            Display
          </p>
          <h2 className="font-serif text-[18px] md:text-[20px] leading-tight text-ink">
            Preferences
          </h2>
        </header>
        <dl className="px-2 py-2">
          <Row label="Date format">d LLL yyyy (Indian convention)</Row>
          <Row label="Week starts on">Monday</Row>
          <Row label="Default task priority">Low</Row>
        </dl>
        <p className="px-5 pb-4 text-[11px] text-ink-3 leading-relaxed">
          These are baked into the app for v1. A configurable surface lives in
          the Phase 4 polish backlog.
        </p>
      </section>

      {/* Cutover */}
      {isOperational ? (
        <section className="bg-panel border border-success/30 rounded-2xl p-5">
          <p className="text-[10px] uppercase tracking-[0.08em] font-medium text-success mb-1 inline-flex items-center gap-1">
            <i className="ti ti-circle-check text-[11px]" aria-hidden="true" />
            Operational
          </p>
          <h2 className="font-serif text-[18px] md:text-[20px] leading-tight text-ink">
            Cutover already complete
          </h2>
          <p className="text-[12px] text-ink-2 mt-1.5 leading-relaxed">
            This installation transitioned to operational mode at{' '}
            <strong>{cutoverEvent!.createdAt.toISOString().replace('T', ' ').slice(0, 16)}</strong>.
            The audit trail begins from that moment.
          </p>
        </section>
      ) : (
        <CutoverCard />
      )}
    </div>
  );
}

function Row({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-3 px-3 py-2.5">
      <dt className="text-[13px] text-ink-2 w-[160px] shrink-0">{label}</dt>
      <dd className="flex-1 text-[13px] text-right font-medium text-ink">{children}</dd>
    </div>
  );
}
