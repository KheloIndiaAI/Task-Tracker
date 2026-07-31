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
