import { describe, expect, it } from 'vitest';

import { describeNotification } from '@/lib/notifications';

describe('describeNotification — deadline reminders', () => {
  it('renders the today bucket for task_due_soon', () => {
    const d = describeNotification('task_due_soon', { taskId: 't1', taskName: 'Cabinet note', bucket: 'today' });
    expect(d.text).toBe('"Cabinet note" is due today');
    expect(d.href).toBe('/tasks/t1');
    expect(d.accent).toBe('js');
  });

  it('renders the tomorrow bucket for task_due_soon', () => {
    const d = describeNotification('task_due_soon', { taskId: 't1', taskName: 'Cabinet note', bucket: 'tomorrow' });
    expect(d.text).toBe('"Cabinet note" is due tomorrow');
  });

  it('falls back to the legacy wording when no bucket is present', () => {
    const d = describeNotification('task_due_soon', { taskId: 't1', taskName: 'Cabinet note' });
    expect(d.text).toBe('"Cabinet note" is due within 24 hours');
  });

  it('renders a Timeline File deadline reminder linked to the file', () => {
    const d = describeNotification('timeline_file_due_soon', {
      timelineFileId: 'tf1',
      refNo: 'TF-2026/34',
      subject: 'Cabinet brief request',
    });
    expect(d.text).toBe('Timeline file TF-2026/34 — Cabinet brief request is due soon');
    expect(d.href).toBe('/timeline-files/tf1');
  });
});

describe('describeNotification — comment on my task', () => {
  it('names the commenter and the task', () => {
    const d = describeNotification('comment_on_my_task', {
      taskId: 't1',
      taskName: 'Cabinet note',
      actorName: 'Ravi K.',
    });
    expect(d.text).toBe('Ravi K. commented on "Cabinet note"');
    expect(d.href).toBe('/tasks/t1');
  });

  it('degrades gracefully without an actor name', () => {
    const d = describeNotification('comment_on_my_task', { taskId: 't1', taskName: 'Cabinet note' });
    expect(d.text).toBe('New comment on "Cabinet note"');
  });
});

describe('describeNotification — task_assigned reasons', () => {
  const base = { taskId: 't1', taskName: 'Cabinet note', assignedByName: 'Ravi K.' };

  it('renders each reason distinctly', () => {
    expect(describeNotification('task_assigned', { ...base, reason: 'assigned' }).text).toBe(
      'Ravi K. assigned "Cabinet note" to you',
    );
    expect(describeNotification('task_assigned', { ...base, reason: 'reassigned' }).text).toBe(
      'Ravi K. reassigned "Cabinet note" to you',
    );
    expect(describeNotification('task_assigned', { ...base, reason: 'transferred' }).text).toBe(
      'Ravi K. transferred "Cabinet note" to you',
    );
    expect(describeNotification('task_assigned', { ...base, reason: 'subtask' }).text).toBe(
      'Ravi K. assigned you the subtask "Cabinet note"',
    );
    expect(describeNotification('task_assigned', { ...base, reason: 'collaborator' }).text).toBe(
      'Ravi K. added you as a collaborator on "Cabinet note"',
    );
    expect(describeNotification('task_assigned', { ...base, reason: 'pmu_team_share' }).text).toBe(
      'Ravi K. shared "Cabinet note" with your PMU team',
    );
  });

  it('falls back to the assigned wording when reason is absent (legacy) or unknown', () => {
    expect(describeNotification('task_assigned', base).text).toBe('Ravi K. assigned "Cabinet note" to you');
    expect(describeNotification('task_assigned', { ...base, reason: 'wat' }).text).toBe(
      'Ravi K. assigned "Cabinet note" to you',
    );
  });

  it('uses the no-actor wording when no name is present', () => {
    expect(
      describeNotification('task_assigned', { taskId: 't1', taskName: 'Cabinet note', reason: 'collaborator' }).text,
    ).toBe('You were added as a collaborator on "Cabinet note"');
  });
});
