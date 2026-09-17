import { describe, expect, it } from 'vitest';

import { buildTaskFilterClause } from '@/lib/visibility-rules';

const ME = 'user-me';

describe('buildTaskFilterClause — the My tasks pill', () => {
  it('narrows to what the caller OWNS', () => {
    expect(buildTaskFilterClause('mine', ME)).toMatchObject({ ownerId: ME });
  });

  it('hides completed work, exactly like the unfiltered board', () => {
    // The pill must not show a completed task of mine in the active list while
    // the card ALSO lists it under Completed underneath — which is what the
    // bare { ownerId } clause did.
    expect(buildTaskFilterClause('mine', ME)).toEqual({
      ownerId: ME,
      status: { not: 'completed' },
    });
    expect(buildTaskFilterClause('all', ME)).toEqual({ status: { not: 'completed' } });
  });

  it('scopes to the caller and nobody else', () => {
    const other = buildTaskFilterClause('mine', 'someone-else') as { ownerId?: string };
    expect(other.ownerId).toBe('someone-else');
  });
});

describe('buildTaskFilterClause — the rest of the vocabulary', () => {
  it('completed is the one filter that asks FOR completed work', () => {
    expect(buildTaskFilterClause('completed', ME)).toEqual({ status: 'completed' });
  });

  it('urgent does not constrain status — an urgent task stays listed', () => {
    expect(buildTaskFilterClause('urgent', ME)).toEqual({ priority: 'urgent' });
  });

  it('js_priority is open work carrying a lane', () => {
    expect(buildTaskFilterClause('js_priority', ME)).toEqual({
      jsPriorityLane: { not: null },
      status: { not: 'completed' },
    });
  });

  it('today and overdue bound the due date, overdue excluding completed', () => {
    const today = buildTaskFilterClause('today', ME) as { dueDate?: { gte?: Date; lte?: Date } };
    expect(today.dueDate?.gte).toBeInstanceOf(Date);
    expect(today.dueDate?.lte).toBeInstanceOf(Date);
    expect((today.dueDate!.gte as Date).getTime()).toBeLessThan(
      (today.dueDate!.lte as Date).getTime(),
    );

    const overdue = buildTaskFilterClause('overdue', ME);
    expect(overdue).toMatchObject({ status: { not: 'completed' } });
  });

  it('never leaks the caller id into a filter that is not about them', () => {
    for (const filter of ['all', 'today', 'overdue', 'urgent', 'completed', 'js_priority'] as const) {
      expect(JSON.stringify(buildTaskFilterClause(filter, ME))).not.toContain(ME);
    }
  });
});
