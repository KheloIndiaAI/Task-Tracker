import { NextResponse } from 'next/server';
import { renderToBuffer } from '@react-pdf/renderer';
import { z } from 'zod';

import { auth } from '@/lib/auth';
import { prisma } from '@/lib/db';
import { formatDateTimeIST, isoDay } from '@/lib/date';
import { getHeadedDivisionIds } from '@/lib/rbac';
import { rateLimit } from '@/lib/rate-limit';
import { logError } from '@/lib/utils/log';
import { fetchReportDivisionGroups } from '@/lib/reports';
import {
  canAccessReportGeneration,
  REPORT_CADENCE_LABEL,
  isReportCadence,
} from '@/lib/reports-shared';
import { registerReportFonts } from '@/lib/pdf/fonts';
import { PriorityTaskReportDocument } from '@/lib/pdf/PriorityTaskReportDocument';

// @react-pdf/renderer (via pdfkit/fontkit) needs real Node builtins (fs, the
// Node streams used by renderToBuffer) — it cannot run on the Edge runtime.
export const runtime = 'nodejs';

/**
 * GET /api/reports/priority-task
 *
 * Query params (all optional, all validated leniently — this is a filter
 * dialog's own generated link, not third-party input):
 *   division   — a division/PMU id, or omitted for every division the
 *                caller can see
 *   cadence    — today | week | fortnight | month, or omitted for all four
 *   scope      — 'scheduled' (default; only tasks carrying a JS Priority
 *                lane) or 'all' (every matching task, unscheduled ones
 *                included)
 *   status     — '1' to include the Status column/section
 *   jsComment  — '1' to include the JS Comment column/section
 *
 * Layout is not a param of its own — the moment either `status` or
 * `jsComment` is on, the report switches from the compact Division ×
 * cadence grid to the detailed one-row-per-task table with those columns
 * (see PriorityTaskReportDocument's doc comment). This is the exact
 * "checkboxes choose the layout" rule the report dialog documents to the
 * caller.
 */

const querySchema = z.object({
  division: z.string().uuid().optional(),
  cadence: z.string().optional(),
  scope: z.enum(['scheduled', 'all']).optional(),
  status: z.string().optional(),
  jsComment: z.string().optional(),
});

export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const { ok: allowed } = rateLimit(`report:${session.user.id}`, 10, 60_000);
  if (!allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const me = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      hierarchySlot: true,
      isSuperAdmin: true,
      divisionId: true,
      isPmu: true,
      pmuId: true,
      canGenerateReports: true,
    },
  });
  if (!me) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  const headedDivisionIds = await getHeadedDivisionIds(me.id);
  if (!canAccessReportGeneration(me, headedDivisionIds)) {
    return NextResponse.json({ error: 'Report generation access is required.' }, { status: 403 });
  }

  const parsed = querySchema.safeParse(
    Object.fromEntries(new URL(request.url).searchParams),
  );
  if (!parsed.success) {
    return NextResponse.json({ error: 'Invalid filters' }, { status: 400 });
  }

  const cadence = parsed.data.cadence && isReportCadence(parsed.data.cadence) ? parsed.data.cadence : null;
  const scope = parsed.data.scope ?? 'scheduled';
  const includeStatus = parsed.data.status === '1';
  const includeJsComment = parsed.data.jsComment === '1';
  const divisionId = parsed.data.division ?? null;

  const [divisionLabel, groups] = await Promise.all([
    divisionId
      ? prisma.division.findUnique({ where: { id: divisionId }, select: { name: true } }).then(
          (d) => d?.name ?? 'All divisions',
        )
      : Promise.resolve('All divisions'),
    fetchReportDivisionGroups(me, {
      divisionId,
      cadence,
      scope,
      includeStatus,
      includeJsComment,
    }),
  ]);

  const now = new Date();
  const layout = includeStatus || includeJsComment ? 'detailed' : 'compact';

  try {
    registerReportFonts();
    const buffer = await renderToBuffer(
      <PriorityTaskReportDocument
        groups={groups}
        layout={layout}
        includeUnscheduled={scope === 'all'}
        divisionLabel={divisionLabel}
        cadenceLabel={cadence ? REPORT_CADENCE_LABEL[cadence] : 'All cadences'}
        scopeLabel={scope === 'all' ? 'All tasks' : 'Scheduled tasks only'}
        includeStatus={includeStatus}
        includeJsComment={includeJsComment}
        generatedAtLabel={formatDateTimeIST(now)}
      />,
    );

    return new NextResponse(new Uint8Array(buffer), {
      status: 200,
      headers: {
        'Content-Type': 'application/pdf',
        'Content-Disposition': `attachment; filename="priority-task-report-${isoDay(now)}.pdf"`,
        'Cache-Control': 'no-store',
      },
    });
  } catch (err) {
    logError('Priority task report generation failed', err);
    return NextResponse.json({ error: 'Could not generate the report.' }, { status: 500 });
  }
}
