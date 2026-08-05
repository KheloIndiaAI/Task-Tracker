import { NextResponse } from 'next/server';
import { z } from 'zod';
import { logError } from '@/lib/utils/log';

import {
  canAddTaskAttachments,
  canEditTfAttachments,
} from '@/app/actions/attachments';
import { auth } from '@/lib/auth';
import { canAccessBusinessCardsById } from '@/lib/business-cards';
import { canAccessDocumentCentreById } from '@/lib/document-centre';
import { rateLimit } from '@/lib/rate-limit';
import {
  generateObjectKey,
  isS3Configured,
  MAX_UPLOAD_BYTES,
  presignUpload,
  type AttachmentScope,
} from '@/lib/s3';

/**
 * POST /api/attachments/upload-url
 *
 * Body: {
 *   scope: 'task' | 'tf_source' | 'tf_action',
 *   parentId: uuid,
 *   filename: string,
 *   contentType: string,
 *   sizeBytes: number,
 * }
 *
 * Returns: { key, url, expiresInSeconds }
 */

const bodySchema = z.object({
  scope: z.enum(['task', 'tf_source', 'tf_action', 'document', 'business_card']),
  parentId: z.string().uuid(),
  filename: z.string().trim().min(1).max(200),
  contentType: z.string().trim().min(1).max(200),
  sizeBytes: z.number().int().positive().max(MAX_UPLOAD_BYTES),
});

export async function POST(request: Request) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  const { ok: rateLimited } = rateLimit(`upload:${session.user.id}`, 20, 60_000);
  if (!rateLimited) {
    return NextResponse.json({ error: 'Too many requests' }, { status: 429 });
  }

  if (!isS3Configured()) {
    return NextResponse.json(
      { error: 'Storage is not configured on this server.' },
      { status: 503 },
    );
  }

  let raw: unknown;
  try {
    raw = await request.json();
  } catch {
    return NextResponse.json({ error: 'Body must be JSON' }, { status: 400 });
  }
  const parsed = bodySchema.safeParse(raw);
  if (!parsed.success) {
    return NextResponse.json(
      { error: 'Invalid body', issues: parsed.error.issues },
      { status: 400 },
    );
  }

  if (!isAllowedMimeType(parsed.data.contentType)) {
    return NextResponse.json(
      { error: 'File type not allowed' },
      { status: 400 },
    );
  }

  // Permission gate — collaborators may add task documents; Document Centre is
  // gated by the executive allowlist.
  const allowed =
    parsed.data.scope === 'task'
      ? await canAddTaskAttachments(session.user.id, parsed.data.parentId)
      : parsed.data.scope === 'document'
        ? await canAccessDocumentCentreById(session.user.id)
        : parsed.data.scope === 'business_card'
          ? await canAccessBusinessCardsById(session.user.id)
          : await canEditTfAttachments(session.user.id, parsed.data.parentId);
  if (!allowed) {
    return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  const scope: AttachmentScope =
    parsed.data.scope === 'task'
      ? { kind: 'task', taskId: parsed.data.parentId }
      : parsed.data.scope === 'tf_source'
        ? { kind: 'tf_source', tfId: parsed.data.parentId }
        : parsed.data.scope === 'tf_action'
          ? { kind: 'tf_action', tfId: parsed.data.parentId }
          : parsed.data.scope === 'document'
            ? { kind: 'document', documentId: parsed.data.parentId }
            : { kind: 'business_card', businessCardId: parsed.data.parentId };
  const key = generateObjectKey(scope, parsed.data.filename);

  try {
    const { url, expiresInSeconds } = await presignUpload({
      key,
      contentType: parsed.data.contentType,
      contentLength: parsed.data.sizeBytes,
    });
    return NextResponse.json({ key, url, expiresInSeconds });
  } catch (err) {
    logError('presignUpload failed', err);
    return NextResponse.json(
      { error: 'Could not generate upload URL' },
      { status: 500 },
    );
  }
}

const ALLOWED_MIME_PREFIXES = ['image/', 'audio/', 'video/'];
const ALLOWED_MIME_EXACT = new Set([
  'application/pdf',
  'application/msword',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  'application/vnd.ms-excel',
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  'application/vnd.ms-powerpoint',
  'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  'application/vnd.oasis.opendocument.text',
  'application/vnd.oasis.opendocument.spreadsheet',
  'application/vnd.oasis.opendocument.presentation',
  'application/zip',
  'application/x-rar-compressed',
  'application/x-7z-compressed',
  'text/plain',
  'text/csv',
]);

function isAllowedMimeType(mime: string): boolean {
  const lower = mime.toLowerCase();
  if (ALLOWED_MIME_EXACT.has(lower)) return true;
  return ALLOWED_MIME_PREFIXES.some((prefix) => lower.startsWith(prefix));
}
