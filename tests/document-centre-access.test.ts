import { describe, expect, it } from 'vitest';

import { canAccessDocumentCentre } from '@/lib/document-centre-shared';

describe('canAccessDocumentCentre', () => {
  it('grants access when the per-user flag is set', () => {
    expect(
      canAccessDocumentCentre({ isSuperAdmin: false, canAccessDocumentCentre: true }),
    ).toBe(true);
  });

  it('always grants access to a Super Admin, even without the flag', () => {
    expect(
      canAccessDocumentCentre({ isSuperAdmin: true, canAccessDocumentCentre: false }),
    ).toBe(true);
  });

  it('denies a user who is neither a Super Admin nor granted the flag', () => {
    expect(
      canAccessDocumentCentre({ isSuperAdmin: false, canAccessDocumentCentre: false }),
    ).toBe(false);
  });
});
