import { NextResponse } from 'next/server';

import { auth } from '@/lib/auth';
import { rateLimit } from '@/lib/rate-limit';
import { isQuerySearchable, searchPreview } from '@/lib/search';

/**
 * Search preview endpoint — drives the header dropdown.
 *
 * Returns JSON with `tasks`, `timelineFiles`, `users`, `tags`, `documents`
 * (top 5 each) and totals. Scoped to the caller's visibility on tasks + TFs;
 * documents are gated on Document Centre access and come back empty for
 * everyone else; users + tags are open to every signed-in caller.
 *
 * No edge runtime: prisma needs the Node runtime.
 */
export async function GET(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const url = new URL(request.url);
  const q = (url.searchParams.get('q') ?? '').trim();

  const { ok: allowed } = rateLimit(`search:${session.user.id}`, 30, 60_000);
  if (!allowed) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  if (!isQuerySearchable(q)) {
    return NextResponse.json({
      query: q,
      tasks: [],
      timelineFiles: [],
      users: [],
      tags: [],
      documents: [],
      totals: { tasks: 0, timelineFiles: 0, users: 0, tags: 0, documents: 0 },
    });
  }

  const results = await searchPreview(session.user.id, q);
  return NextResponse.json(results);
}
