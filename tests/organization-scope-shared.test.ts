import { describe, expect, it } from 'vitest';

import {
  ALL_ORGANIZATIONS,
  ALL_ORGANIZATIONS_LABEL,
  defaultReportOrganization,
  parseOrganizationParam,
  resolveBoardOrganization,
} from '@/lib/organization-scope-shared';
import type { StructureTreeNode } from '@/lib/structure-shared';

/**
 * The production shape: Ministry Headquarter, and SAI with its Regional
 * Centres as directorates running divisions of the same names.
 *
 *   HQ   (organization "Ministry Headquarter") ── OJS, KIS (── KIS_PMU)
 *   SAI  (organization "SAI") ── RC_B (directorate) ── NCOE_B
 *                            └─ OPS (division, directly under SAI)
 *   LEGACY (division with no parent — outside every organization)
 */
function node(
  id: string,
  kind: StructureTreeNode['kind'],
  parentId: string | null,
  pmuParentDivisionId: string | null = null,
): StructureTreeNode {
  return { id, kind, parentId, pmuParentDivisionId };
}

const NODES: StructureTreeNode[] = [
  node('HQ', 'organization', null),
  node('SAI', 'organization', null),
  node('RC_B', 'directorate', 'SAI'),
  node('OJS', 'division', 'HQ'),
  node('KIS', 'division', 'HQ'),
  node('KIS_PMU', 'pmu', null, 'KIS'),
  node('NCOE_B', 'division', 'RC_B'),
  node('OPS', 'division', 'SAI'),
  node('LEGACY', 'division', null),
];

const ORGS = [
  { id: 'HQ', name: 'Ministry Headquarter' },
  { id: 'SAI', name: 'SAI' },
];

const resolve = (params: { org?: string | null; division?: string | null }, orgs = ORGS) =>
  resolveBoardOrganization(params, orgs, NODES);

describe('resolveBoardOrganization — which organization the Super Admin board shows', () => {
  it('opens on Ministry Headquarter when nothing is asked for', () => {
    expect(resolve({})).toBe('HQ');
    expect(resolve({ org: '', division: '' })).toBe('HQ');
    expect(resolve({ org: null, division: null })).toBe('HQ');
  });

  it('follows the organization pill', () => {
    expect(resolve({ org: 'SAI' })).toBe('SAI');
    expect(resolve({ org: 'HQ' })).toBe('HQ');
  });

  it('"all" is every organization — the board as it was before the pills', () => {
    expect(ALL_ORGANIZATIONS).toBe('all');
    expect(ALL_ORGANIZATIONS_LABEL).toBe('All organizations');
    expect(resolve({ org: 'all' })).toBeNull();
    // A division inside "all" is still inside it — no need to switch.
    expect(resolve({ org: 'all', division: 'NCOE_B' })).toBeNull();
  });

  it('a division link lands on the organization that holds the division', () => {
    expect(resolve({ division: 'NCOE_B' })).toBe('SAI');
    expect(resolve({ division: 'OJS' })).toBe('HQ');
    // A PMU team sits where its division does.
    expect(resolve({ division: 'KIS_PMU' })).toBe('HQ');
  });

  it('the division wins over an organization it is not in — never an empty board', () => {
    expect(resolve({ org: 'HQ', division: 'NCOE_B' })).toBe('SAI');
    expect(resolve({ org: 'SAI', division: 'KIS' })).toBe('HQ');
    expect(resolve({ org: 'SAI', division: 'OPS' })).toBe('SAI');
  });

  it('a division outside every listed organization opens every organization', () => {
    expect(resolve({ division: 'LEGACY' })).toBeNull();
    expect(resolve({ org: 'HQ', division: 'LEGACY' })).toBeNull();
    expect(resolve({ division: 'no-such-division' })).toBeNull();
  });

  it('a stale or hand-typed organization falls back to the default', () => {
    expect(resolve({ org: 'gone' })).toBe('HQ');
    // A real node that is not an offered organization is not a choice either.
    expect(resolve({ org: 'RC_B' })).toBe('HQ');
    expect(resolve({ org: 'KIS' })).toBe('HQ');
  });

  it('with no Ministry Headquarter, the default is every organization', () => {
    const renamed = [
      { id: 'HQ', name: 'Ministry HQ' },
      { id: 'SAI', name: 'SAI' },
    ];
    expect(resolve({}, renamed)).toBeNull();
    // An explicit pick still works.
    expect(resolve({ org: 'SAI' }, renamed)).toBe('SAI');
  });

  it('with no organizations at all, nothing is ever narrowed', () => {
    expect(resolve({}, [])).toBeNull();
    expect(resolve({ org: 'HQ' }, [])).toBeNull();
    expect(resolve({ division: 'OJS' }, [])).toBeNull();
  });

  it('ignores surrounding spaces in the params', () => {
    expect(resolve({ org: ' SAI ' })).toBe('SAI');
    expect(resolve({ org: ' all ' })).toBeNull();
    expect(resolve({ division: ' NCOE_B ' })).toBe('SAI');
  });
});

describe('parseOrganizationParam — what a route narrows to', () => {
  it('narrows nothing for absent, empty or "all"', () => {
    expect(parseOrganizationParam(undefined)).toBeNull();
    expect(parseOrganizationParam(null)).toBeNull();
    expect(parseOrganizationParam('')).toBeNull();
    expect(parseOrganizationParam('  ')).toBeNull();
    expect(parseOrganizationParam('all')).toBeNull();
  });

  it('returns anything else as the organization id to look up', () => {
    expect(parseOrganizationParam('HQ')).toBe('HQ');
    expect(parseOrganizationParam(' SAI ')).toBe('SAI');
  });
});

describe('defaultReportOrganization — the report dialog opens on', () => {
  it('Ministry Headquarter when it is offered, wherever it sits in the list', () => {
    expect(defaultReportOrganization(ORGS)).toBe('HQ');
    expect(defaultReportOrganization([...ORGS].reverse())).toBe('HQ');
  });

  it('the first organization offered when Ministry Headquarter is not', () => {
    // A Regional Centre officer with report access, say.
    expect(defaultReportOrganization([{ id: 'SAI', name: 'SAI' }])).toBe('SAI');
  });

  it('every organization when none is offered', () => {
    expect(defaultReportOrganization([])).toBe('all');
  });
});
