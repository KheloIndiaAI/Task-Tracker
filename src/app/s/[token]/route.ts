import { NextResponse } from 'next/server';

import { prisma } from '@/lib/db';
import { isOfficeDocument, officeWebViewerUrl } from '@/lib/mime';
import { isS3Configured, presignView } from '@/lib/s3';
import { logError } from '@/lib/utils/log';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * GET /s/:token — PUBLIC, no auth.
 *
 * Open share link for a single attachment. The token is unguessable and maps
 * to exactly one file. On each click we mint a fresh, short-lived presigned
 * URL and 302-redirect to it — to the Microsoft Office web viewer for Office
 * documents, or straight to the file otherwise. The AWS signature never
 * appears in the shared link, and the short link keeps working even though
 * each underlying presigned URL expires quickly.
 *
 * Links never expire and are not revocable by design (per requirements); the
 * only gate is possession of the unguessable token.
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
  { params }: { params: { token: string } },
) {
  const token = params.token;
  if (!token || token.length < 16 || token.length > 64) {
    return new NextResponse('Not found', { status: 404 });
  }

  const att = await prisma.attachment.findUnique({
    where: { shareToken: token },
    select: { fileUrl: true, fileName: true, mimeType: true, source: true },
  });
  if (!att) {
    return new NextResponse('This link is no longer valid.', { status: 404 });
  }

  // Drive links are already short — redirect straight to the Google URL.
  if (att.source === 'drive_link') {
    if (!isSafeDriveLinkUrl(att.fileUrl)) {
      return new NextResponse('Blocked link.', { status: 403 });
    }
    return NextResponse.redirect(att.fileUrl, 302);
  }

  if (!isS3Configured()) {
    return new NextResponse('Storage is not configured on this server.', { status: 503 });
  }

  try {
    const presigned = await presignView({
      key: att.fileUrl,
      filename: att.fileName,
      contentType: att.mimeType ?? undefined,
    });
    const target = isOfficeDocument(att.fileName, att.mimeType)
      ? officeWebViewerUrl(presigned)
      : presigned;
    return NextResponse.redirect(target, 302);
  } catch (err) {
    logError('share link presign failed', err);
    return new NextResponse('Could not open the file.', { status: 500 });
  }
}
