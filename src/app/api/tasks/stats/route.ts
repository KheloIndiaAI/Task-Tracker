import { NextResponse } from 'next/server';

import { auth } from '@/lib/auth';
import { resolveOrganizationScope } from '@/lib/organization-scope';
import { rateLimit } from '@/lib/rate-limit';
import { fetchOpenTasksByDivision, fetchStatTasks } from '@/lib/visibility';

/**
 * GET /api/tasks/stats?kind=today|overdue|completed|divisions[&org=<id>|all]
 *
 * Drill-down data behind the tasks-page stat tiles. Everything is scoped to
 * the caller's task visibility (buildVisibilityClauses), so a popup can never
 * reveal a task the user could not already see on the board.
 *
 * `org` is the organization the Super Admin's board is showing (see
 * organization-scope-shared.ts), sent so a tile's list matches the tile's
 * number. It only narrows, on top of visibility; absent or 'all' leaves the
 * lists exactly as they were.
 */
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const { ok: allowed } = rateLimit(`taskstats:${session.user.id}`, 60, 60_000);
  if (!allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  const searchParams = new URL(request.url).searchParams;
  const kind = searchParams.get('kind');
  if (kind !== 'today' && kind !== 'overdue' && kind !== 'completed' && kind !== 'divisions') {
    return NextResponse.json({ error: 'Invalid kind' }, { status: 400 });
  }

  const organization = await resolveOrganizationScope(searchParams.get('org'));
  const scope = organization ? { scopeDivisionIds: organization.divisionIds } : {};

  if (kind === 'divisions') {
    const divisions = await fetchOpenTasksByDivision(session.user.id, scope);
    return NextResponse.json({ divisions });
  }
  const tasks = await fetchStatTasks(session.user.id, kind, scope);
  return NextResponse.json({ tasks });
}
