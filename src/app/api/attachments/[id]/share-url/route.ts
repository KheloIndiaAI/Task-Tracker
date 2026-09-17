import { NextResponse } from 'next/server';

import { auth } from '@/lib/auth';
import { logError } from '@/lib/utils/log';
import { prisma } from '@/lib/db';
import { isS3Configured, presignShare } from '@/lib/s3';
import { buildTfVisibilityClause } from '@/lib/timeline-files';
import { buildVisibilityClauses, visibilityAnd } from '@/lib/visibility';

/**
 * GET /api/attachments/:id/share-url
 *
 * Returns a shareable URL for the attachment (24h TTL presigned S3 link
 * for uploads, raw URL for drive links). Used by the WhatsApp share flow.
 */
const ALLOWED_DRIVE_HOSTS = new Set([
  'drive.google.com',
  'docs.google.com',
  'sheets.google.com',
  'slides.google.com',
]);

function isSafeDriveLinkUrl(url: string): boolean {
  try {
    const parsed = new URL(url);
    return parsed.protocol === 'https:' && ALLOWED_DRIVE_HOSTS.has(parsed.hostname);
  } catch {
    return false;
  }
}

export async function GET(
  _request: Request,
  { params }: { params: { id: string } },
) {
  const session = await auth();
  if (!session?.user) {
    return NextResponse.json({ error: 'Not signed in' }, { status: 401 });
  }

  if (!/^[0-9a-f-]{36}$/i.test(params.id)) {
    return NextResponse.json({ error: 'Bad id' }, { status: 400 });
  }

  const att = await prisma.attachment.findUnique({
    where: { id: params.id },
    select: {
      id: true,
      ownerType: true,
      ownerId: true,
      fileUrl: true,
      fileName: true,
      source: true,
    },
  });
  if (!att) return NextResponse.json({ error: 'Not found' }, { status: 404 });

  const me = await prisma.user.findUnique({
    where: { id: session.user.id },
    select: {
      id: true,
      hierarchySlot: true,
      isSuperAdmin: true,
      divisionId: true,
      isPmu: true,
      pmuId: true,
    },
  });
  if (!me) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });

  if (att.ownerType === 'task' || att.ownerType === 'task_comment') {
    const visibility = await buildVisibilityClauses(me);
    const visible = await prisma.task.findFirst({
      where: { id: att.ownerId, AND: visibilityAnd(visibility) },
      select: { id: true },
    });
    if (!visible) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  } else if (att.ownerType.startsWith('timeline_file')) {
    const tfVisibility = await buildTfVisibilityClause(me);
    const visible = await prisma.timelineFile.findFirst({
      where: { id: att.ownerId, AND: [tfVisibility] },
      select: { id: true },
    });
    if (!visible) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (att.source === 'drive_link') {
    if (!isSafeDriveLinkUrl(att.fileUrl)) {
      return NextResponse.json({ error: 'Blocked redirect URL' }, { status: 403 });
    }
    return NextResponse.json({ url: att.fileUrl, fileName: att.fileName });
  }

  if (!isS3Configured()) {
    return NextResponse.json(
      { error: 'Storage is not configured on this server.' },
      { status: 503 },
    );
  }

  try {
    const url = await presignShare({
      key: att.fileUrl,
      filename: att.fileName,
    });
    return NextResponse.json({ url, fileName: att.fileName });
  } catch (err) {
    logError('presignShare failed', err);
    return NextResponse.json({ error: 'Could not generate URL' }, { status: 500 });
  }
}
