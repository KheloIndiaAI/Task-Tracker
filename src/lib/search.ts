import type { Prisma, TaskPriority, TaskStatus } from '@prisma/client';

import { prisma } from '@/lib/db';
import { quickSearchDocuments } from '@/lib/document-search';
import { formatDue, initialsOf } from '@/lib/format';
import { USER_SUMMARY_SELECT } from '@/lib/prisma-selects';
import { buildTfVisibilityClause } from '@/lib/timeline-files';
import { buildVisibilityClauses } from '@/lib/visibility';

/**
 * Global search across tasks, timeline files, users, and tags.
 *
 * Authorisation:
 *   - Tasks → existing task-visibility scoper (same as /tasks)
 *   - TFs   → existing TF-visibility scoper (same as /timeline-files)
 *   - Users → any signed-in user can browse the active-user directory
 *   - Tags  → any signed-in user can browse the master tag list
 */

const MIN_QUERY_LENGTH = 2;
const PREVIEW_PER_GROUP = 5;
const FULL_PER_GROUP = 50;

// URL-sourced filter values are validated against these before being
// passed to Prisma as enum filters.
const SEARCHABLE_STATUSES = [
  'not_started',
  'in_progress',
  'awaiting_input',
  'on_hold',
  'completed',
] as const;
const SEARCHABLE_PRIORITIES = ['low', 'medium', 'high', 'urgent'] as const;

// ============================================================
// Types
// ============================================================

export type SearchTaskResult = {
  id: string;
  name: string;
  status: string;
  divisionName: string;
  divisionColour: string;
  ownerName: string;
  ownerInitials: string;
  href: string;
};

export type SearchTfResult = {
  id: string;
  refNo: string;
  subject: string;
  fromWhom: string;
  status: string;
  href: string;
};

export type SearchUserResult = {
  id: string;
  name: string;
  username: string;
  designation: string;
  divisionColour: string;
  isActive: boolean;
  href: string;
};

export type SearchTagResult = {
  id: string;
  name: string;
  taskCount: number;
  href: string;
};

export type SearchDocumentResult = {
  id: string;
  subject: string;
  status: string;
  urgency: string;
  createdByName: string;
  href: string;
};

export type SearchResults = {
  query: string;
  tasks: SearchTaskResult[];
  timelineFiles: SearchTfResult[];
  users: SearchUserResult[];
  tags: SearchTagResult[];
  documents: SearchDocumentResult[];
  totals: {
    tasks: number;
    timelineFiles: number;
    users: number;
    tags: number;
    documents: number;
  };
};

export type SearchType = 'all' | 'tasks' | 'timeline_files' | 'users' | 'tags' | 'documents';

export type SearchTaskFilters = {
  status?: string;
  priority?: string;
  divisionId?: string;
  dueFrom?: string;
  dueTo?: string;
  jsPriority?: boolean;
  /** Restrict to tasks carrying this exact tag (uuid). Set when the user
   *  opens a tag from search results to see everything under it.
   *  Super Admin-only (tags are an admin feature). */
  tagId?: string;
};

// ============================================================
// Helpers
// ============================================================

const MAX_QUERY_LENGTH = 200;

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normaliseQuery(raw: string | null | undefined): string {
  return escapeIlike((raw ?? '').trim().slice(0, MAX_QUERY_LENGTH));
}

function escapeIlike(s: string): string {
  return s.replace(/[%_\\]/g, (c) => `\\${c}`);
}

export function isQuerySearchable(query: string): boolean {
  return query.length >= MIN_QUERY_LENGTH;
}

function initials(name: string): string {
  const parts = name
    .replace(/[().]/g, '')
    .split(/\s+/)
    .filter(Boolean);
  if (parts.length === 0) return '?';
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return ((parts[0][0] ?? '') + (parts[parts.length - 1][0] ?? '')).toUpperCase();
}

// ============================================================
// Per-entity searches
// ============================================================

export async function searchTasksFor(
  callerId: string,
  query: string,
  take: number,
  filters?: SearchTaskFilters,
): Promise<{ rows: SearchTaskResult[]; total: number }> {
  const q = normaliseQuery(query);
  if (!isQuerySearchable(q)) return { rows: [], total: 0 };

  const me = await prisma.user.findUnique({
    where: { id: callerId },
    select: {
      id: true,
      hierarchySlot: true,
      isSuperAdmin: true,
      divisionId: true,
      isPmu: true,
      pmuId: true,
    },
  });
  if (!me) return { rows: [], total: 0 };

  const visibility = await buildVisibilityClauses(me);
  const orClauses: Prisma.TaskWhereInput[] = [
    { name: { contains: q, mode: 'insensitive' } },
    { refNumber: { contains: q, mode: 'insensitive' } },
    { description: { contains: q, mode: 'insensitive' } },
    { owner: { name: { contains: q, mode: 'insensitive' } } },
  ];
  // Tags are a Super Admin-only feature — only their search matches a task by
  // its tag names.
  if (me.isSuperAdmin) {
    orClauses.push({ tags: { some: { tag: { name: { contains: q, mode: 'insensitive' } } } } });
  }
  const filter: Prisma.TaskWhereInput = {
    archivedAt: null,
    parentTaskId: null,
    OR: orClauses,
  };
  const andClauses: Prisma.TaskWhereInput[] = [{ OR: visibility }, filter];

  if (filters) {
    if (filters.status && (SEARCHABLE_STATUSES as readonly string[]).includes(filters.status)) {
      andClauses.push({ status: filters.status as TaskStatus });
    }
    if (filters.priority && (SEARCHABLE_PRIORITIES as readonly string[]).includes(filters.priority)) {
      andClauses.push({ priority: filters.priority as TaskPriority });
    }
    if (filters.divisionId) andClauses.push({ divisionId: filters.divisionId });
    // Opening a tag from search results narrows to exactly its tasks — a
    // Super Admin-only path. Guard the uuid shape so a hand-edited ?tag=
    // can't throw at the Postgres cast.
    if (me.isSuperAdmin && filters.tagId && UUID_RE.test(filters.tagId)) {
      andClauses.push({ tags: { some: { tagId: filters.tagId } } });
    }
    if (filters.jsPriority) andClauses.push({ jsPriorityLane: { not: null } });
    if (filters.dueFrom || filters.dueTo) {
      const dueDateClause: Prisma.DateTimeNullableFilter = {};
      if (filters.dueFrom) dueDateClause.gte = new Date(filters.dueFrom);
      if (filters.dueTo) {
        const end = new Date(filters.dueTo);
        end.setHours(23, 59, 59, 999);
        dueDateClause.lte = end;
      }
      andClauses.push({ dueDate: dueDateClause });
    }
  }

  const where: Prisma.TaskWhereInput = {
    AND: andClauses,
  };

  const [rowsRaw, total] = await Promise.all([
    prisma.task.findMany({
      where,
      include: {
        owner: { select: USER_SUMMARY_SELECT },
        division: true,
      },
      orderBy: [{ updatedAt: 'desc' }],
      take,
    }),
    prisma.task.count({ where }),
  ]);

  const rows: SearchTaskResult[] = rowsRaw.map((t) => ({
    id: t.id,
    name: t.name,
    status: t.status,
    divisionName: t.division.name,
    divisionColour: t.division.avatarColour,
    ownerName: t.owner.name,
    ownerInitials: initials(t.owner.name),
    href: `/tasks/${t.id}`,
  }));

  return { rows, total };
}

export async function searchTimelineFilesFor(
  callerId: string,
  query: string,
  take: number,
): Promise<{ rows: SearchTfResult[]; total: number }> {
  const q = normaliseQuery(query);
  if (!isQuerySearchable(q)) return { rows: [], total: 0 };

  const me = await prisma.user.findUnique({
    where: { id: callerId },
    select: {
      id: true,
      hierarchySlot: true,
      isSuperAdmin: true,
      divisionId: true,
    },
  });
  if (!me) return { rows: [], total: 0 };

  const visibility = await buildTfVisibilityClause(me);
  const filter: Prisma.TimelineFileWhereInput = {
    archivedAt: null,
    OR: [
      { refNo: { contains: q, mode: 'insensitive' } },
      { subject: { contains: q, mode: 'insensitive' } },
      { fromWhom: { contains: q, mode: 'insensitive' } },
    ],
  };
  const where: Prisma.TimelineFileWhereInput = {
    AND: [visibility, filter],
  };

  const [rowsRaw, total] = await Promise.all([
    prisma.timelineFile.findMany({
      where,
      select: {
        id: true,
        refNo: true,
        subject: true,
        fromWhom: true,
        status: true,
      },
      orderBy: [{ receivedDate: 'desc' }],
      take,
    }),
    prisma.timelineFile.count({ where }),
  ]);

  const rows: SearchTfResult[] = rowsRaw.map((tf) => ({
    id: tf.id,
    refNo: tf.refNo,
    subject: tf.subject,
    fromWhom: tf.fromWhom,
    status: tf.status,
    href: `/timeline-files/${tf.id}`,
  }));

  return { rows, total };
}

export async function searchUsersFor(
  query: string,
  take: number,
): Promise<{ rows: SearchUserResult[]; total: number }> {
  const q = normaliseQuery(query);
  if (!isQuerySearchable(q)) return { rows: [], total: 0 };

  const where: Prisma.UserWhereInput = {
    isActive: true,
    OR: [
      { name: { contains: q, mode: 'insensitive' } },
      { username: { contains: q, mode: 'insensitive' } },
      { designation: { contains: q, mode: 'insensitive' } },
    ],
  };
  const [rowsRaw, total] = await Promise.all([
    prisma.user.findMany({
      where,
      select: {
        id: true,
        name: true,
        username: true,
        designation: true,
        isActive: true,
        division: { select: { avatarColour: true } },
      },
      orderBy: [{ isActive: 'desc' }, { name: 'asc' }],
      take,
    }),
    prisma.user.count({ where }),
  ]);

  const rows: SearchUserResult[] = rowsRaw.map((u) => ({
    id: u.id,
    name: u.name,
    username: u.username,
    designation: u.designation,
    divisionColour: u.division.avatarColour,
    isActive: u.isActive,
    // Profile screens aren't built for other users yet — clicking falls back
    // to a tasks-by-owner search for now.
    href: `/search?q=${encodeURIComponent(u.name)}&type=tasks`,
  }));

  return { rows, total };
}

export async function searchTagsFor(
  callerId: string,
  query: string,
  take: number,
): Promise<{ rows: SearchTagResult[]; total: number }> {
  const q = normaliseQuery(query);
  if (!isQuerySearchable(q)) return { rows: [], total: 0 };

  // Tags are a Super Admin-only feature — no one else searches or sees them.
  const me = await prisma.user.findUnique({
    where: { id: callerId },
    select: { isSuperAdmin: true },
  });
  if (!me?.isSuperAdmin) return { rows: [], total: 0 };

  const where: Prisma.TagWhereInput = {
    name: { contains: q, mode: 'insensitive' },
  };
  const [rowsRaw, total] = await Promise.all([
    prisma.tag.findMany({
      where,
      select: {
        id: true,
        name: true,
        _count: { select: { tasks: true } },
      },
      orderBy: { name: 'asc' },
      take,
    }),
    prisma.tag.count({ where }),
  ]);

  const rows: SearchTagResult[] = rowsRaw.map((t) => ({
    id: t.id,
    name: t.name,
    taskCount: t._count.tasks,
    // Open the tag to everything under it — a tasks search narrowed to this
    // exact tag (the tagId filter in searchTasksFor). Works for every user
    // and stays visibility-scoped, unlike the Super-Admin-only tag manager.
    href: `/search?q=${encodeURIComponent(t.name)}&type=tasks&tag=${t.id}`,
  }));

  return { rows, total };
}

// ============================================================
// Aggregated entry points
// ============================================================

/**
 * Document Centre records for the global search.
 *
 * Delegates the matching AND the access gate to `quickSearchDocuments`, which
 * covers subject, context, attachment file names, Drive links and discussion
 * bodies, and returns nothing at all for a caller without Document Centre
 * access. Keeping one implementation means the global bar can never drift into
 * showing a record the module itself would withhold.
 */
export async function searchDocumentsFor(
  callerId: string,
  query: string,
  limit: number,
): Promise<{ rows: SearchDocumentResult[]; total: number }> {
  const q = normaliseQuery(query);
  if (!isQuerySearchable(q)) return { rows: [], total: 0 };

  const { rows, total } = await quickSearchDocuments(callerId, q, limit);
  return {
    rows: rows.map((r) => ({
      id: r.id,
      subject: r.subject,
      status: r.status,
      urgency: r.urgency,
      createdByName: r.createdByName,
      href: `/document-centre/${r.id}`,
    })),
    total,
  };
}

export async function searchPreview(
  callerId: string,
  query: string,
): Promise<SearchResults> {
  const [tasks, timelineFiles, users, tags, documents] = await Promise.all([
    searchTasksFor(callerId, query, PREVIEW_PER_GROUP),
    searchTimelineFilesFor(callerId, query, PREVIEW_PER_GROUP),
    searchUsersFor(query, PREVIEW_PER_GROUP),
    searchTagsFor(callerId, query, PREVIEW_PER_GROUP),
    searchDocumentsFor(callerId, query, PREVIEW_PER_GROUP),
  ]);
  return {
    query,
    tasks: tasks.rows,
    timelineFiles: timelineFiles.rows,
    users: users.rows,
    tags: tags.rows,
    documents: documents.rows,
    totals: {
      tasks: tasks.total,
      timelineFiles: timelineFiles.total,
      users: users.total,
      tags: tags.total,
      documents: documents.total,
    },
  };
}

// ============================================================
// Tasks-page Quick Search — full task-card data, deep field coverage
// ============================================================

/**
 * A search result shaped for the tasks-list `TaskCard`. Serialisable, so the
 * `/api/tasks/search` route can hand it straight to the client, which renders
 * it with the same card the list uses (identical look; opens the task on tap).
 */
export type QuickSearchTaskCard = {
  taskId: string;
  refNumber: string | null;
  name: string;
  division: { name: string };
  status: string;
  priority: string;
  jsPriorityLane: string | null;
  due: { label: string; tone: 'today' | 'overdue' | 'soon' | 'future' | 'none' };
  owner: { initials: string; colour: string; name: string };
  subtasks: { done: number; total: number } | null;
  hasAttachment: boolean;
  primaryDivisionName: string | null;
  href: string;
};

const QUICK_SEARCH_LIMIT = 50;
const QUICK_SEARCH_ATTACHMENT_SCAN = 500;

/**
 * Deep quick-search for the tasks page. Matches a task when the query hits any
 * of: title, description/context, ref number, owner name, a subtask's name or
 * description, a discussion comment, an attached document's name, or (Super
 * Admin only) a tag — then returns full card data for every match the caller
 * may see. Visibility-scoped through the same `buildVisibilityClauses` as the
 * list, so it can never surface a task the caller couldn't already open, and it
 * is independent of the list's active filters.
 */
export async function quickSearchTasks(
  callerId: string,
  query: string,
): Promise<{ rows: QuickSearchTaskCard[]; total: number; capped: boolean }> {
  const q = normaliseQuery(query);
  if (!isQuerySearchable(q)) return { rows: [], total: 0, capped: false };

  const me = await prisma.user.findUnique({
    where: { id: callerId },
    select: {
      id: true,
      hierarchySlot: true,
      isSuperAdmin: true,
      divisionId: true,
      isPmu: true,
      pmuId: true,
    },
  });
  if (!me) return { rows: [], total: 0, capped: false };

  const visibility = await buildVisibilityClauses(me);

  // Document-name matches: task-scope attachments whose file name hits the
  // query. Attachments are polymorphic (no Task relation), so we resolve the
  // owning task ids first, then fold them into the OR. Visibility is still
  // enforced by the outer clause, so this never leaks a hidden task's doc.
  const attachmentTaskIds = (
    await prisma.attachment.findMany({
      where: { ownerType: 'task', fileName: { contains: q, mode: 'insensitive' } },
      // Distinct on the owning task so the cap counts distinct tasks, not raw
      // attachment rows (a task with many matching docs consumes one slot).
      distinct: ['ownerId'],
      select: { ownerId: true },
      take: QUICK_SEARCH_ATTACHMENT_SCAN,
    })
  ).map((a) => a.ownerId);

  const orClauses: Prisma.TaskWhereInput[] = [
    { name: { contains: q, mode: 'insensitive' } },
    { refNumber: { contains: q, mode: 'insensitive' } },
    // description IS the task's "Context" field (see SectionContext).
    { description: { contains: q, mode: 'insensitive' } },
    { owner: { name: { contains: q, mode: 'insensitive' } } },
    { subtasks: { some: { name: { contains: q, mode: 'insensitive' } } } },
    { subtasks: { some: { description: { contains: q, mode: 'insensitive' } } } },
    // discussions
    { comments: { some: { body: { contains: q, mode: 'insensitive' } } } },
  ];
  if (attachmentTaskIds.length > 0) orClauses.push({ id: { in: attachmentTaskIds } });
  // Tags are a Super Admin-only feature — mirror searchTasksFor's gate.
  if (me.isSuperAdmin) {
    orClauses.push({ tags: { some: { tag: { name: { contains: q, mode: 'insensitive' } } } } });
  }

  const where: Prisma.TaskWhereInput = {
    archivedAt: null,
    parentTaskId: null,
    AND: [{ OR: visibility }, { OR: orClauses }],
  };

  const [tasks, total] = await Promise.all([
    prisma.task.findMany({
      where,
      include: {
        owner: { select: USER_SUMMARY_SELECT },
        division: { select: { name: true } },
        subtasks: { select: { status: true } },
        collaborators: { select: { role: true } },
      },
      // Most-recently-active first — the same relevance the "Recently modified"
      // sort uses.
      orderBy: [{ lastActivityAt: 'desc' }],
      take: QUICK_SEARCH_LIMIT,
    }),
    prisma.task.count({ where }),
  ]);

  // Batched paperclip indicator for the shown tasks.
  const ids = tasks.map((t) => t.id);
  const withAttachment = new Set<string>();
  if (ids.length > 0) {
    const rows = await prisma.attachment.findMany({
      where: { ownerType: 'task', ownerId: { in: ids } },
      select: { ownerId: true },
    });
    for (const r of rows) withAttachment.add(r.ownerId);
  }

  const rows: QuickSearchTaskCard[] = tasks.map((t) => {
    const subtaskTotal = t.subtasks.length;
    const subtaskDone = t.subtasks.filter((s) => s.status === 'completed').length;
    return {
      taskId: t.id,
      refNumber: t.refNumber,
      name: t.name,
      division: { name: t.division.name },
      status: t.status,
      priority: t.priority,
      jsPriorityLane: t.jsPriorityLane,
      due: formatDue(t.dueDate),
      owner: {
        initials: initialsOf(t.owner.name),
        colour: t.owner.division.avatarColour,
        name: t.owner.name,
      },
      subtasks: subtaskTotal > 0 ? { done: subtaskDone, total: subtaskTotal } : null,
      hasAttachment: withAttachment.has(t.id),
      primaryDivisionName: t.collaborators.some((c) => c.role === 'division_lead')
        ? t.division.name
        : null,
      href: `/tasks/${t.id}`,
    };
  });

  return { rows, total, capped: total > QUICK_SEARCH_LIMIT };
}

export async function searchFull(
  callerId: string,
  query: string,
  type: SearchType,
  taskFilters?: SearchTaskFilters,
): Promise<SearchResults> {
  const include = {
    tasks: type === 'all' || type === 'tasks',
    timelineFiles: type === 'all' || type === 'timeline_files',
    users: type === 'all' || type === 'users',
    tags: type === 'all' || type === 'tags',
    documents: type === 'all' || type === 'documents',
  };

  const [tasks, timelineFiles, users, tags, documents] = await Promise.all([
    include.tasks
      ? searchTasksFor(callerId, query, FULL_PER_GROUP, taskFilters)
      : Promise.resolve({ rows: [], total: 0 }),
    include.timelineFiles
      ? searchTimelineFilesFor(callerId, query, FULL_PER_GROUP)
      : Promise.resolve({ rows: [], total: 0 }),
    include.users
      ? searchUsersFor(query, FULL_PER_GROUP)
      : Promise.resolve({ rows: [], total: 0 }),
    include.tags
      ? searchTagsFor(callerId, query, FULL_PER_GROUP)
      : Promise.resolve({ rows: [], total: 0 }),
    include.documents
      ? searchDocumentsFor(callerId, query, FULL_PER_GROUP)
      : Promise.resolve({ rows: [], total: 0 }),
  ]);

  return {
    query,
    tasks: tasks.rows,
    timelineFiles: timelineFiles.rows,
    users: users.rows,
    tags: tags.rows,
    documents: documents.rows,
    totals: {
      tasks: tasks.total,
      timelineFiles: timelineFiles.total,
      users: users.total,
      tags: tags.total,
      documents: documents.total,
    },
  };
}
