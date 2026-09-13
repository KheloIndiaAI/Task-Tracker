import { describe, expect, it } from 'vitest';

import { canAccessReportGeneration, isReportCadence } from '@/lib/reports-shared';

const base = { isSuperAdmin: false, hierarchySlot: 'section_officer', canGenerateReports: false };

describe('canAccessReportGeneration', () => {
  it('always grants access to a Super Admin', () => {
    expect(canAccessReportGeneration({ ...base, isSuperAdmin: true }, [])).toBe(true);
  });

  it('always grants access to OSD', () => {
    expect(canAccessReportGeneration({ ...base, hierarchySlot: 'osd' }, [])).toBe(true);
  });

  it('grants access to any division head', () => {
    expect(canAccessReportGeneration(base, ['division-1'])).toBe(true);
  });

  it('grants access when the per-user flag is set', () => {
    expect(canAccessReportGeneration({ ...base, canGenerateReports: true }, [])).toBe(true);
  });

  it('denies a user with none of the four grants', () => {
    expect(canAccessReportGeneration(base, [])).toBe(false);
  });
});

describe('isReportCadence', () => {
  it('accepts every board lane value', () => {
    expect(isReportCadence('today')).toBe(true);
    expect(isReportCadence('week')).toBe(true);
    expect(isReportCadence('fortnight')).toBe(true);
    expect(isReportCadence('month')).toBe(true);
  });

  it('rejects anything else', () => {
    expect(isReportCadence('all')).toBe(false);
    expect(isReportCadence('')).toBe(false);
    expect(isReportCadence('watchlist')).toBe(false);
  });
});
