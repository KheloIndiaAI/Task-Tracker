import { describe, expect, it } from 'vitest';

import { canAccessBusinessCards } from '@/lib/business-cards-shared';

describe('canAccessBusinessCards', () => {
  it('grants access when the per-user flag is set', () => {
    expect(canAccessBusinessCards({ isSuperAdmin: false, canAccessBusinessCards: true })).toBe(true);
  });

  it('always grants access to a Super Admin, even without the flag', () => {
    expect(canAccessBusinessCards({ isSuperAdmin: true, canAccessBusinessCards: false })).toBe(true);
  });

  it('denies a user who is neither a Super Admin nor granted the flag', () => {
    expect(canAccessBusinessCards({ isSuperAdmin: false, canAccessBusinessCards: false })).toBe(false);
  });
});
