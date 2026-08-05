import {
  DeleteObjectCommand,
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';
import { randomUUID } from 'crypto';

/**
 * S3 wiring. Works against any S3-compatible endpoint — AWS S3 in
 * ap-south-1, MinIO on localhost, or Cloudflare R2 — without code changes.
 *
 * Configuration via env (see .env.sample):
 *   S3_ENDPOINT, S3_REGION, S3_BUCKET, S3_ACCESS_KEY, S3_SECRET_KEY,
 *   S3_FORCE_PATH_STYLE, S3_PRESIGN_TTL_SECONDS
 *
 * When any required var is missing, `isS3Configured()` returns false and
 * the UI degrades gracefully — Drive links still work; native uploads
 * disable with a helpful note.
 */

let cachedClient: S3Client | null = null;

const UPLOAD_TTL_SECONDS = 15 * 60; // browser PUT must complete within 15 min
const DEFAULT_DOWNLOAD_TTL = 3600; // 1 hour
const SHARE_TTL_SECONDS = 4 * 60 * 60; // 4h for WhatsApp-shared links

export function isS3Configured(): boolean {
  return Boolean(
    process.env.S3_ENDPOINT &&
      process.env.S3_BUCKET &&
      process.env.S3_ACCESS_KEY &&
      process.env.S3_SECRET_KEY,
  );
}

function s3Bucket(): string {
  const b = process.env.S3_BUCKET;
  if (!b) throw new Error('S3_BUCKET not set');
  return b;
}

function downloadTtl(): number {
  const raw = process.env.S3_PRESIGN_TTL_SECONDS;
  const n = raw ? Number(raw) : DEFAULT_DOWNLOAD_TTL;
  return Number.isFinite(n) && n > 0 ? n : DEFAULT_DOWNLOAD_TTL;
}

function s3Client(): S3Client {
  if (cachedClient) return cachedClient;
  if (!isS3Configured()) {
    throw new Error('S3 is not configured. See .env.sample.');
  }
  cachedClient = new S3Client({
    endpoint: process.env.S3_ENDPOINT,
    region: process.env.S3_REGION ?? 'us-east-1',
    credentials: {
      accessKeyId: process.env.S3_ACCESS_KEY!,
      secretAccessKey: process.env.S3_SECRET_KEY!,
    },
    forcePathStyle: process.env.S3_FORCE_PATH_STYLE === 'true',
  });
  return cachedClient;
}

// ============================================================
// Key generation
// ============================================================

export type AttachmentScope =
  | { kind: 'task'; taskId: string }
  | { kind: 'tf_source'; tfId: string }
  | { kind: 'tf_action'; tfId: string }
  | { kind: 'document'; documentId: string }
  | { kind: 'business_card'; businessCardId: string };

export function objectKeyPrefix(scope: AttachmentScope): string {
  switch (scope.kind) {
    case 'task':
      return `tasks/${scope.taskId}`;
    case 'tf_source':
      return `timeline-files/${scope.tfId}/source`;
    case 'tf_action':
      return `timeline-files/${scope.tfId}/action`;
    case 'document':
      return `document-records/${scope.documentId}`;
    case 'business_card':
      return `business-cards/${scope.businessCardId}`;
  }
}

export function generateObjectKey(scope: AttachmentScope, filename: string): string {
  const safe = sanitizeFilename(filename);
  return `${objectKeyPrefix(scope)}/${randomUUID()}-${safe}`;
}

export function sanitizeFilename(filename: string): string {
  const cleaned = filename.replace(/[^\w.-]+/g, '_').slice(0, 120);
  return cleaned.length > 0 ? cleaned : 'file';
}

/** Cheap server-side check that a posted key matches the expected scope. */
export function keyMatchesScope(key: string, scope: AttachmentScope): boolean {
  return key.startsWith(`${objectKeyPrefix(scope)}/`);
}

// ============================================================
// Presigned URLs
// ============================================================

export async function presignUpload(opts: {
  key: string;
  contentType: string;
  contentLength: number;
}): Promise<{ url: string; expiresInSeconds: number }> {
  const cmd = new PutObjectCommand({
    Bucket: s3Bucket(),
    Key: opts.key,
    ContentType: opts.contentType,
    ContentLength: opts.contentLength,
  });
  const url = await getSignedUrl(s3Client(), cmd, { expiresIn: UPLOAD_TTL_SECONDS });
  return { url, expiresInSeconds: UPLOAD_TTL_SECONDS };
}

export async function presignDownload(opts: {
  key: string;
  filename?: string;
}): Promise<string> {
  const cmd = new GetObjectCommand({
    Bucket: s3Bucket(),
    Key: opts.key,
    ResponseContentDisposition: opts.filename
      ? `attachment; filename="${sanitizeFilename(opts.filename)}"`
      : undefined,
  });
  return getSignedUrl(s3Client(), cmd, { expiresIn: downloadTtl() });
}

export async function presignView(opts: {
  key: string;
  filename?: string;
  contentType?: string;
}): Promise<string> {
  const cmd = new GetObjectCommand({
    Bucket: s3Bucket(),
    Key: opts.key,
    ResponseContentDisposition: opts.filename
      ? `inline; filename="${sanitizeFilename(opts.filename)}"`
      : 'inline',
    ResponseContentType: opts.contentType || undefined,
  });
  return getSignedUrl(s3Client(), cmd, { expiresIn: downloadTtl() });
}

export async function presignShare(opts: {
  key: string;
  filename?: string;
}): Promise<string> {
  const cmd = new GetObjectCommand({
    Bucket: s3Bucket(),
    Key: opts.key,
    ResponseContentDisposition: opts.filename
      ? `attachment; filename="${sanitizeFilename(opts.filename)}"`
      : undefined,
  });
  return getSignedUrl(s3Client(), cmd, { expiresIn: SHARE_TTL_SECONDS });
}

export async function deleteObject(key: string): Promise<void> {
  await s3Client().send(new DeleteObjectCommand({ Bucket: s3Bucket(), Key: key }));
}

// ============================================================
// File-type helpers (UI consumes these)
// ============================================================

export type FileBadge = { label: string; tone: 'pdf' | 'doc' | 'xls' | 'img' | 'drive' | 'file' };

export function fileBadgeFor(filename: string, source: 'uploaded' | 'drive_link'): FileBadge {
  if (source === 'drive_link') return { label: 'LINK', tone: 'drive' };
  const ext = filename.split('.').pop()?.toLowerCase() ?? '';
  if (['pdf'].includes(ext)) return { label: 'PDF', tone: 'pdf' };
  if (['doc', 'docx'].includes(ext)) return { label: 'DOC', tone: 'doc' };
  if (['xls', 'xlsx', 'csv'].includes(ext)) return { label: 'XLS', tone: 'xls' };
  if (['jpg', 'jpeg', 'png', 'gif', 'webp', 'svg'].includes(ext)) {
    return { label: 'IMG', tone: 'img' };
  }
  return { label: ext ? ext.toUpperCase().slice(0, 4) : 'FILE', tone: 'file' };
}

export function formatBytes(bytes: number | bigint | null | undefined): string {
  if (bytes == null) return '';
  const n = typeof bytes === 'bigint' ? Number(bytes) : bytes;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

export const MAX_UPLOAD_BYTES = 100 * 1024 * 1024; // 100 MB hard cap
