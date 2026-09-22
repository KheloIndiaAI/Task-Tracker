import { describe, expect, it } from 'vitest';

import {
  collectReportingSubtree,
  partitionOrgChart,
  resolveUnitPlacement,
  type ChartNodeInput,
  type UnitNode,
} from '@/lib/org-chart';

/**
 * Collect every id the mapper would render: pool + roots + all children.
 * The core invariant is that this equals the input set exactly, with no
 * duplicates — the bug that hid SGM_PMU members was a violation of it.
 */
function renderedIds(nodes: ChartNodeInput[]): string[] {
  const p = partitionOrgChart(nodes);
  const out = [...p.unassignedIds, ...p.rootIds];
  for (const kids of p.childrenByParent.values()) out.push(...kids);
  return out;
}

function expectRendersEveryoneOnce(nodes: ChartNodeInput[]) {
  const rendered = renderedIds(nodes);
  expect(new Set(rendered).size).toBe(rendered.length); // no duplicates
  expect(new Set(rendered)).toEqual(new Set(nodes.map((n) => n.id))); // total
}

describe('partitionOrgChart — totality (nobody is dropped)', () => {
  it('handles a simple in-view chain', () => {
    const nodes: ChartNodeInput[] = [
      { id: 'head', supervisorId: null },
      { id: 'tl', supervisorId: 'head' },
      { id: 'c1', supervisorId: 'tl' },
      { id: 'c2', supervisorId: 'tl' },
    ];
    expectRendersEveryoneOnce(nodes);
    const p = partitionOrgChart(nodes);
    expect(p.unassignedIds).toEqual(['head']);
    expect(p.childrenByParent.get('tl')).toEqual(['c1', 'c2']);
  });

  it('renders officers whose supervisor is OUTSIDE the view (the PMU case)', () => {
    // SGM_PMU shown alone: the team's supervisor (Harilal) is the division
    // head, injected into the view; but if he were NOT injected, the team
    // lead must still appear as a root rather than vanish.
    const nodes: ChartNodeInput[] = [
      { id: 'tl', supervisorId: 'harilal-outside' },
      { id: 'c1', supervisorId: 'tl' },
      { id: 'c2', supervisorId: 'tl' },
      { id: 'c3', supervisorId: 'tl' },
      { id: 'c4', supervisorId: 'tl' },
    ];
    expectRendersEveryoneOnce(nodes);
    const p = partitionOrgChart(nodes);
    expect(p.rootIds).toContain('tl');
    expect(p.childrenByParent.get('tl')?.sort()).toEqual(['c1', 'c2', 'c3', 'c4']);
  });

  it('promotes a subtree whose top reports into the Unassigned pool', () => {
    // 'lead' is unassigned (pool); 'a' reports to 'lead'. 'a' is reachable
    // only through a pool member, so it must be promoted, not dropped.
    const nodes: ChartNodeInput[] = [
      { id: 'lead', supervisorId: null },
      { id: 'a', supervisorId: 'lead' },
      { id: 'b', supervisorId: 'a' },
    ];
    expectRendersEveryoneOnce(nodes);
    const p = partitionOrgChart(nodes);
    expect(p.unassignedIds).toEqual(['lead']);
    // 'a' is promoted to a root; 'b' nests under it once.
    expect(p.rootIds).toContain('a');
    expect(p.childrenByParent.get('a')).toEqual(['b']);
  });

  it('does not render a promoted node twice (edge is dropped)', () => {
    const nodes: ChartNodeInput[] = [
      { id: 'pool', supervisorId: null },
      { id: 'x', supervisorId: 'pool' },
    ];
    const p = partitionOrgChart(nodes);
    // 'x' is a root, and must NOT also appear as a child of 'pool'.
    expect(p.rootIds).toContain('x');
    expect(p.childrenByParent.get('pool') ?? []).not.toContain('x');
    expectRendersEveryoneOnce(nodes);
  });

  it('survives a supervisor cycle without dropping or infinite-looping', () => {
    const nodes: ChartNodeInput[] = [
      { id: 'a', supervisorId: 'b' },
      { id: 'b', supervisorId: 'a' },
      { id: 'c', supervisorId: 'a' },
    ];
    expectRendersEveryoneOnce(nodes);
  });

  it('handles a mixed division: chain + external report + pool', () => {
    const nodes: ChartNodeInput[] = [
      { id: 'dir', supervisorId: 'osd-outside' }, // root (external sup)
      { id: 'so', supervisorId: 'dir' },
      { id: 'aso1', supervisorId: 'so' },
      { id: 'aso2', supervisorId: 'so' },
      { id: 'floater', supervisorId: null }, // pool
      { id: 'orphan', supervisorId: 'floater' }, // promoted from pool parent
    ];
    expectRendersEveryoneOnce(nodes);
    const p = partitionOrgChart(nodes);
    expect(p.rootIds).toContain('dir');
    expect(p.rootIds).toContain('orphan');
    expect(p.unassignedIds).toEqual(['floater']);
  });

  it('handles an empty division', () => {
    expect(renderedIds([])).toEqual([]);
  });

  it('handles everyone-unassigned', () => {
    const nodes: ChartNodeInput[] = [
      { id: 'a', supervisorId: null },
      { id: 'b', supervisorId: null },
    ];
    const p = partitionOrgChart(nodes);
    expect(p.unassignedIds.sort()).toEqual(['a', 'b']);
    expect(p.rootIds).toEqual([]);
    expectRendersEveryoneOnce(nodes);
  });
});

describe('collectReportingSubtree', () => {
  const org: ChartNodeInput[] = [
    { id: 'tl', supervisorId: 'head' },
    { id: 'sc1', supervisorId: 'tl' },
    { id: 'sc2', supervisorId: 'tl' },
    { id: 'c1', supervisorId: 'sc1' },
    { id: 'other', supervisorId: 'head' },
    { id: 'head', supervisorId: null },
  ];

  it('collects the lead and every transitive report', () => {
    expect(collectReportingSubtree(org, 'tl').sort()).toEqual(
      ['c1', 'sc1', 'sc2', 'tl'].sort(),
    );
  });

  it('a leaf is a team of one', () => {
    expect(collectReportingSubtree(org, 'c1')).toEqual(['c1']);
  });

  it('excludes siblings and superiors', () => {
    const team = collectReportingSubtree(org, 'tl');
    expect(team).not.toContain('head');
    expect(team).not.toContain('other');
  });

  it('is cycle-safe', () => {
    const cyclic: ChartNodeInput[] = [
      { id: 'a', supervisorId: 'b' },
      { id: 'b', supervisorId: 'a' },
    ];
    const team = collectReportingSubtree(cyclic, 'a');
    expect(new Set(team)).toEqual(new Set(['a', 'b']));
    expect(team.length).toBe(2); // no duplicates, terminates
  });
});

describe('resolveUnitPlacement', () => {
  const division: UnitNode = { id: 'D', kind: 'division', parentId: null, pmuParentDivisionId: null };
  const sub: UnitNode = { id: 'S', kind: 'sub_division', parentId: 'D', pmuParentDivisionId: null };
  const section: UnitNode = { id: 'SEC', kind: 'section', parentId: 'S', pmuParentDivisionId: null };
  const pmu: UnitNode = { id: 'P', kind: 'pmu', parentId: null, pmuParentDivisionId: 'D' };
  const byId = new Map<string, UnitNode>([
    ['D', division],
    ['S', sub],
    ['SEC', section],
    ['P', pmu],
  ]);

  it('division: clears sub/section/pmu, not a PMU member', () => {
    expect(resolveUnitPlacement(division, byId)).toEqual({
      divisionId: 'D',
      subDivisionId: null,
      sectionId: null,
      pmuId: null,
      isPmu: false,
    });
  });

  it('sub-division: sets division + sub, clears section/pmu', () => {
    expect(resolveUnitPlacement(sub, byId)).toEqual({
      divisionId: 'D',
      subDivisionId: 'S',
      sectionId: null,
      pmuId: null,
      isPmu: false,
    });
  });

  it('section: sets the full division/sub/section chain', () => {
    expect(resolveUnitPlacement(section, byId)).toEqual({
      divisionId: 'D',
      subDivisionId: 'S',
      sectionId: 'SEC',
      pmuId: null,
      isPmu: false,
    });
  });

  it('pmu: sets home division + pmu, clears ladder, marks PMU member', () => {
    expect(resolveUnitPlacement(pmu, byId)).toEqual({
      divisionId: 'D',
      subDivisionId: null,
      sectionId: null,
      pmuId: 'P',
      isPmu: true,
    });
  });

  it('pmu with parentId fallback (no pmuParentDivisionId) still resolves home', () => {
    const legacyPmu: UnitNode = { id: 'P2', kind: 'pmu', parentId: 'D', pmuParentDivisionId: null };
    const r = resolveUnitPlacement(legacyPmu, byId);
    expect('error' in r).toBe(false);
    if (!('error' in r)) expect(r.divisionId).toBe('D');
  });

  it('errors on a section whose sub-division is missing', () => {
    const orphan: UnitNode = { id: 'X', kind: 'section', parentId: 'gone', pmuParentDivisionId: null };
    const r = resolveUnitPlacement(orphan, byId);
    expect('error' in r).toBe(true);
  });

  it('errors on a sub-division with no parent', () => {
    const orphan: UnitNode = { id: 'Y', kind: 'sub_division', parentId: null, pmuParentDivisionId: null };
    expect('error' in resolveUnitPlacement(orphan, byId)).toBe(true);
  });

  // People are homed in divisions; organizations and directorates only group
  // divisions, so a drop onto either is refused rather than written.
  it('refuses a drop onto an organization', () => {
    const org: UnitNode = { id: 'HQ', kind: 'organization', parentId: null, pmuParentDivisionId: null };
    expect('error' in resolveUnitPlacement(org, byId)).toBe(true);
  });

  it('refuses a drop onto a directorate', () => {
    const dir: UnitNode = { id: 'DIR', kind: 'directorate', parentId: 'HQ', pmuParentDivisionId: null };
    expect('error' in resolveUnitPlacement(dir, byId)).toBe(true);
  });

  it('a division inside an organization still places exactly as before', () => {
    const nested: UnitNode = { id: 'D2', kind: 'division', parentId: 'HQ', pmuParentDivisionId: null };
    expect(resolveUnitPlacement(nested, byId)).toEqual({
      divisionId: 'D2',
      subDivisionId: null,
      sectionId: null,
      pmuId: null,
      isPmu: false,
    });
  });
});
