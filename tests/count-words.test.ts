import { describe, expect, it } from 'vitest';

import { countWords, MAX_LATEST_STATUS_WORDS } from '@/lib/format';

describe('countWords', () => {
  it('counts space-separated words', () => {
    expect(countWords('Plan submitted to the minister')).toBe(5);
  });

  it('treats any run of whitespace as one separator', () => {
    expect(countWords('Plan   submitted\nto\tthe minister')).toBe(5);
  });

  it('ignores leading and trailing whitespace', () => {
    expect(countWords('   Plan submitted   ')).toBe(2);
  });

  it('counts an empty or whitespace-only string as zero, not one', () => {
    expect(countWords('')).toBe(0);
    expect(countWords('   ')).toBe(0);
  });

  it('counts a single word as one', () => {
    expect(countWords('Pending')).toBe(1);
  });
});

describe('MAX_LATEST_STATUS_WORDS', () => {
  it('is 50, as specified', () => {
    expect(MAX_LATEST_STATUS_WORDS).toBe(50);
  });
});
