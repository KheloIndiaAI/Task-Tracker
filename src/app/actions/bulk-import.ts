'use server';
import { logError } from '@/lib/utils/log';

import { revalidatePath } from 'next/cache';
import { z } from 'zod';

import { auth } from '@/lib/auth';
import { parseCsv, rowsToObjects } from '@/lib/csv';
import { prisma } from '@/lib/db';
import { parseDueDateInput } from '@/lib/format';
import { nextTaskRefNumber } from '@/lib/task-ref';

/**
 * Bulk-import server actions (PRD §5.5 — UI present in v1, real commits
 * gated behind an Super-Admin guard + per-row validation).
 *
 *   - parseImportAction       → upload CSV, get a validated preview
 *   - commitImportAction      → take a verified preview, create tasks
 *
 * The preview round-trips through the client (we send back the validated
 * payload) and is re-validated on commit. Trust nothing the client sends.
 */

// ============================================================
// Types
// ============================================================

export type ImportPreviewRow = {
  index: number;
  raw: Record<string, string>;
  ok: boolean;
  error?: string;
  resolved?: {
    name: string;
    description?: string;
    dueDate?: string;
    priority: 'low' | 'medium' | 'high' | 'urgent';
    divisionId: string;
    divisionName: string;
    ownerId: string;
    ownerName: string;
    tagNames: string[];
  };
};

export type ParsePreviewState = {
  ok: boolean;
  error?: string;
  preview?: ImportPreviewRow[];
  epoch?: number;
};

export type CommitState = {
  ok: boolean;
  error?: string;
  createdCount?: number;
  skippedCount?: number;
  epoch?: number;
};

// ============================================================
// Shared helpers
// ============================================================

async function requireSuperAdmin() {
  const session = await auth();
  if (!session?.user) return { ok: false as const, error: 'You are signed out.' };
  const me = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: { isSuperAdmin: true, isActive: true },
  });
  if (!me?.isActive) return { ok: false as const, error: 'Your account is unavailable.' };
  if (!me.isSuperAdmin) return { ok: false as const, error: 'Super Admin access is required.' };
  return { ok: true as const, userId: session.user.id };
}

const REQUIRED_HEADERS = [
  'name',
  'description',
  'due_date',
  'priority',
  'division_name',
  'owner_username',
  'tags',
];

const rowSchema = z.object({
  name: z.string().trim().min(1, 'name is required').max(200, 'name is too long'),
  description: z.string().trim().max(2000).optional(),
  due_date: z
    .string()
    .trim()
    .optional()
    .refine((s) => !s || !Number.isNaN(Date.parse(s)), 'due_date is invalid'),
  priority: z
    .string()
    .trim()
    .optional()
    .transform((s) => (s ? s.toLowerCase() : 'low'))
    .refine(
      (s) => ['low', 'medium', 'high', 'urgent'].includes(s),
      'priority must be low / medium / high / urgent',
    ),
  division_name: z.string().trim().min(1, 'division_name is required'),
  owner_username: z.string().trim().min(1, 'owner_username is required'),
  tags: z.string().trim().optional(),
});

// ============================================================
// parseImportAction
// ============================================================

export async function parseImportAction(
  prev: ParsePreviewState | undefined,
  formData: FormData,
): Promise<ParsePreviewState> {
  const epoch = (prev?.epoch ?? 0) + 1;
  const guard = await requireSuperAdmin();
  if (!guard.ok) return { ok: false, error: guard.error, epoch };

  const file = formData.get('file');
  if (!(file instanceof File)) {
    return { ok: false, error: 'No file uploaded.', epoch };
  }
  if (file.size === 0) return { ok: false, error: 'File is empty.', epoch };
  if (file.size > 1_000_000) {
    return { ok: false, error: 'File is over 1 MB. Split it into smaller batches.', epoch };
  }

  let text: string;
  try {
    text = await file.text();
  } catch {
    return { ok: false, error: 'Could not read the file.', epoch };
  }

  const rows = parseCsv(text);
  const { headers, data } = rowsToObjects(rows);

  // Header check
  const missing = REQUIRED_HEADERS.filter((h) => !headers.includes(h));
  if (missing.length > 0) {
    return {
      ok: false,
      error: `Missing required columns: ${missing.join(', ')}. Download the template.`,
      epoch,
    };
  }
  if (data.length === 0) {
    return { ok: false, error: 'No data rows found.', epoch };
  }
  if (data.length > 500) {
    return {
      ok: false,
      error: 'Maximum 500 rows per import. Split into batches.',
      epoch,
    };
  }

  // Pre-fetch all divisions and active users to resolve names cheaply.
  const [divisions, users] = await Promise.all([
    prisma.division.findMany({
      where: { kind: 'division' },
      select: { id: true, name: true },
    }),
    prisma.user.findMany({
      where: { isActive: true },
      select: { id: true, name: true, username: true },
    }),
  ]);
  const divByName = new Map(divisions.map((d) => [d.name.toLowerCase(), d]));
  const userByUsername = new Map(users.map((u) => [u.username.toLowerCase(), u]));

  const preview: ImportPreviewRow[] = data.map((raw, i) => {
    const parsed = rowSchema.safeParse(raw);
    if (!parsed.success) {
      return {
        index: i + 1,
        raw,
        ok: false,
        error: parsed.error.issues
          .map((iss) => iss.message)
          .slice(0, 2)
          .join(' · '),
      };
    }
    const div = divByName.get(parsed.data.division_name.toLowerCase());
    if (!div) {
      return {
        index: i + 1,
        raw,
        ok: false,
        error: `Division "${parsed.data.division_name}" not found`,
      };
    }
    const owner = userByUsername.get(parsed.data.owner_username.toLowerCase());
    if (!owner) {
      return {
        index: i + 1,
        raw,
        ok: false,
        error: `Owner "${parsed.data.owner_username}" not found / disabled`,
      };
    }

    const tagNames = parsed.data.tags
      ? parsed.data.tags
          .split(/[,;]/)
          .map((t) => t.trim())
          .filter(Boolean)
      : [];

    return {
      index: i + 1,
      raw,
      ok: true,
      resolved: {
        name: parsed.data.name,
        description: parsed.data.description || undefined,
        dueDate: parsed.data.due_date || undefined,
        priority: parsed.data.priority as 'low' | 'medium' | 'high' | 'urgent',
        divisionId: div.id,
        divisionName: div.name,
        ownerId: owner.id,
        ownerName: owner.name,
        tagNames,
      },
    };
  });

  return { ok: true, preview, epoch };
}

// ============================================================
// commitImportAction
// ============================================================

const commitPayloadSchema = z.object({
  rows: z.array(
    z.object({
      name: z.string().min(1).max(200),
      description: z.string().optional(),
      dueDate: z.string().optional(),
      priority: z.enum(['low', 'medium', 'high', 'urgent']),
      divisionId: z.string().uuid(),
      ownerId: z.string().uuid(),
      tagNames: z.array(z.string()),
    }),
  ),
});

export async function commitImportAction(
  prev: CommitState | undefined,
  formData: FormData,
): Promise<CommitState> {
  const epoch = (prev?.epoch ?? 0) + 1;
  const guard = await requireSuperAdmin();
  if (!guard.ok) return { ok: false, error: guard.error, epoch };

  const payloadRaw = formData.get('payload');
  if (typeof payloadRaw !== 'string') {
    return { ok: false, error: 'Missing payload.', epoch };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(payloadRaw);
  } catch {
    return { ok: false, error: 'Payload is not valid JSON.', epoch };
  }

  const parsed = commitPayloadSchema.safeParse(parsedJson);
  if (!parsed.success) {
    return { ok: false, error: 'Payload failed re-validation.', epoch };
  }
  if (parsed.data.rows.length === 0) {
    return { ok: false, error: 'No rows to commit.', epoch };
  }

  // Re-check that every division + owner referenced still exists / is active.
  const divIds = Array.from(new Set(parsed.data.rows.map((r) => r.divisionId)));
  const ownerIds = Array.from(new Set(parsed.data.rows.map((r) => r.ownerId)));

  const [divs, owners] = await Promise.all([
    // Divisions only — the preview resolves nothing else, and no task may
    // live on an organization or directorate (isTaskBoardKind).
    prisma.division.findMany({
      where: { id: { in: divIds }, kind: 'division' },
      select: { id: true },
    }),
    prisma.user.findMany({
      where: { id: { in: ownerIds }, isActive: true },
      select: { id: true },
    }),
  ]);
  const validDivIds = new Set(divs.map((d) => d.id));
  const validOwnerIds = new Set(owners.map((u) => u.id));

  // Tag resolution: any tag-name referenced but missing → create on the fly.
  const allTagNames = Array.from(
    new Set(parsed.data.rows.flatMap((r) => r.tagNames)),
  );
  let tagIdByName = new Map<string, string>();
  if (allTagNames.length > 0) {
    const existingTags = await prisma.tag.findMany({
      where: { name: { in: allTagNames } },
      select: { id: true, name: true },
    });
    tagIdByName = new Map(existingTags.map((t) => [t.name, t.id]));
    const missingNames = allTagNames.filter((n) => !tagIdByName.has(n));
    if (missingNames.length > 0) {
      await prisma.tag.createMany({
        data: missingNames.map((n) => ({ name: n, createdById: guard.userId })),
        skipDuplicates: true,
      });
      const fresh = await prisma.tag.findMany({
        where: { name: { in: missingNames } },
        select: { id: true, name: true },
      });
      for (const t of fresh) tagIdByName.set(t.name, t.id);
    }
  }

  let createdCount = 0;
  let skippedCount = 0;

  for (const row of parsed.data.rows) {
    if (!validDivIds.has(row.divisionId) || !validOwnerIds.has(row.ownerId)) {
      skippedCount++;
      continue;
    }
    try {
      const task = await prisma.$transaction(async (tx) => {
        const refNumber = await nextTaskRefNumber({ divisionId: row.divisionId }, tx);
        return tx.task.create({
          data: {
            refNumber,
            name: row.name,
            description: row.description ?? null,
            ownerId: row.ownerId,
            divisionId: row.divisionId,
            status: 'not_started',
            priority: row.priority,
            dueDate: row.dueDate ? parseDueDateInput(row.dueDate) : null,
            createdById: guard.userId,
          },
        });
      });

      // Tag joins
      const tagJoins = row.tagNames
        .map((n) => tagIdByName.get(n))
        .filter((id): id is string => !!id)
        .map((tagId) => ({ taskId: task.id, tagId }));
      if (tagJoins.length > 0) {
        await prisma.taskTag.createMany({
          data: tagJoins,
          skipDuplicates: true,
        });
      }

      await prisma.taskActivity.create({
        data: {
          taskId: task.id,
          actorId: guard.userId,
          eventType: 'task_created',
          payload: { source: 'bulk_import', name: task.name },
        },
      });

      createdCount++;
    } catch (err) {
      logError('Bulk import row failed', err);
      skippedCount++;
    }
  }

  // Single audit row summarising the import.
  await prisma.auditLog.create({
    data: {
      actorId: guard.userId,
      action: 'create',
      entityType: 'system',
      entityId: '00000000-0000-0000-0000-000000000000',
      before: {},
      after: {
        event: 'bulk_import',
        attempted: parsed.data.rows.length,
        createdCount,
        skippedCount,
      },
    },
  });

  revalidatePath('/tasks');
  revalidatePath('/admin/audit');

  return { ok: true, createdCount, skippedCount, epoch };
}
