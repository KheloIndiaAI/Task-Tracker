import { describe, expect, it } from 'vitest';

import { formatBytes, MAX_UPLOAD_BYTES } from '@/lib/s3';

describe('formatBytes', () => {
  it('scales through B, KB, MB and GB', () => {
    expect(formatBytes(512)).toBe('512 B');
    expect(formatBytes(2048)).toBe('2.0 KB');
    expect(formatBytes(5 * 1024 * 1024)).toBe('5.0 MB');
    expect(formatBytes(2 * 1024 * 1024 * 1024)).toBe('2.0 GB');
  });

  it('renders the upload cap as 1.0 GB, not 1024.0 MB', () => {
    // The whole point of the GB tier: every over-size message quotes this
    // value, so without it the 1 GB cap reads as a four-digit MB figure.
    expect(formatBytes(MAX_UPLOAD_BYTES)).toBe('1.0 GB');
  });

  it('switches unit exactly at each boundary', () => {
    expect(formatBytes(1023)).toBe('1023 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1024 * 1024 - 1)).toBe('1024.0 KB');
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
    expect(formatBytes(1024 * 1024 * 1024 - 1)).toBe('1024.0 MB');
    expect(formatBytes(1024 * 1024 * 1024)).toBe('1.0 GB');
  });

  it('handles bigint and nullish sizes', () => {
    // Attachment sizes arrive from Prisma as BigInt on some columns.
    expect(formatBytes(BigInt(3 * 1024 * 1024))).toBe('3.0 MB');
    expect(formatBytes(null)).toBe('');
    expect(formatBytes(undefined)).toBe('');
  });
});

describe('MAX_UPLOAD_BYTES', () => {
  it('is exactly 1 GiB', () => {
    expect(MAX_UPLOAD_BYTES).toBe(1_073_741_824);
  });

  it('stays inside S3 single-PUT limits', () => {
    // A presigned PUT tops out at 5 GB; anything larger would need multipart,
    // which this upload path does not implement.
    expect(MAX_UPLOAD_BYTES).toBeLessThanOrEqual(5 * 1024 * 1024 * 1024);
  });
});
