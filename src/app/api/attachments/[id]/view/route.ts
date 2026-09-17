import { NextResponse } from 'next/server';

import { auth } from '@/lib/auth';
import { logError } from '@/lib/utils/log';
import { prisma } from '@/lib/db';
import { isOfficeDocument, officeWebViewerUrl } from '@/lib/mime';
import { isS3Configured, presignView } from '@/lib/s3';
import { buildTfVisibilityClause } from '@/lib/timeline-files';
import { buildVisibilityClauses, visibilityAnd } from '@/lib/visibility';

/**
 * GET /api/attachments/:id/view
 *
 * Like the download route but uses Content-Disposition: inline so the
 * browser displays the file (PDF, image) instead of force-downloading.
 */
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
      mimeType: true,
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
    const ok = await prisma.task.findFirst({
      where: { id: att.ownerId, AND: visibilityAnd(visibility) },
      select: { id: true },
    });
    if (!ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  } else if (att.ownerType.startsWith('timeline_file')) {
    const tfVisibility = await buildTfVisibilityClause(me);
    const ok = await prisma.timelineFile.findFirst({
      where: { id: att.ownerId, AND: [tfVisibility] },
      select: { id: true },
    });
    if (!ok) return NextResponse.json({ error: 'Forbidden' }, { status: 403 });
  }

  if (att.source === 'drive_link') {
    if (!isSafeDriveLinkUrl(att.fileUrl)) {
      return NextResponse.json({ error: 'Blocked redirect URL' }, { status: 403 });
    }
    return NextResponse.redirect(att.fileUrl);
  }

  if (!isS3Configured()) {
    return NextResponse.json(
      { error: 'Storage is not configured on this server.' },
      { status: 503 },
    );
  }

  try {
    const url = await presignView({
      key: att.fileUrl,
      filename: att.fileName,
      contentType: att.mimeType ?? undefined,
    });

    // Office documents have no in-browser renderer, so open them directly in a
    // hosted Office viewer — a single, fully-featured tab (print, download,
    // zoom, page navigation). This replaces the old embedded Google preview,
    // which, opened top-level, only offered a "Pop-out" and cascaded through
    // several windows before reaching a usable viewer. PDFs, images and other
    // browser-native types keep going straight to the presigned inline URL.
    if (isOfficeDocument(att.fileName, att.mimeType)) {
      return NextResponse.redirect(officeWebViewerUrl(url));
    }

    return NextResponse.redirect(url);
  } catch (err) {
    logError('presignView failed', err);
    return NextResponse.json({ error: 'Could not generate URL' }, { status: 500 });
  }
}

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
