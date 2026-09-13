'use client';

import { useState } from 'react';
import { format, formatDistanceToNow } from 'date-fns';

import { cn } from '@/lib/utils';

type Activity = {
  id: string;
  eventType: string;
  payload: Record<string, unknown> | null;
  createdAt: Date;
  actor: { name: string };
};

type SectionActivityProps = {
  activity: Activity[];
};

/**
 * Per-task activity log. Top 3 visible; "Show older activity" reveals
 * the rest. Sentence-case copy via the event-type → human-string map.
 */
export function SectionActivity({ activity }: SectionActivityProps) {
  const [showAll, setShowAll] = useState(false);
  const visible = showAll ? activity : activity.slice(0, 3);
  const older = activity.length - 3;

  return (
    <section aria-labelledby="sec-activity" className="px-4 md:px-6 py-5">
      <h2 id="sec-activity" className="section-label mb-3">
        Activity
      </h2>

      {activity.length === 0 ? (
        <p className="text-[13px] text-ink-3 italic">No activity yet.</p>
      ) : (
        <ul className="flex flex-col gap-2">
          {visible.map((e) => (
            <li key={e.id} className="flex items-start gap-2.5 text-[12px] text-ink-2 leading-relaxed">
              <span
                aria-hidden="true"
                className={cn(
                  'w-1.5 h-1.5 rounded-full mt-1.5 shrink-0',
                  isAccent(e.eventType) ? 'bg-accent' : 'bg-ink-4',
                )}
              />
              <span className="flex-1">
                <span className="text-ink font-medium">{e.actor.name}</span>{' '}
                {describeEvent(e.eventType, e.payload)}
                <time
                  className="ml-1.5 text-ink-3 text-[11px]"
                  dateTime={e.createdAt.toISOString()}
                  title={format(e.createdAt, 'd LLL yyyy, h:mm a')}
                >
                  {showsAbsoluteTime(e.eventType)
                    ? `on ${format(e.createdAt, 'd LLL yyyy, h:mm aaa')}`
                    : formatDistanceToNow(e.createdAt, { addSuffix: true })}
                </time>
              </span>
            </li>
          ))}
        </ul>
      )}

      {older > 0 ? (
        <button
          type="button"
          onClick={() => setShowAll((v) => !v)}
          aria-expanded={showAll}
          className="mt-3 inline-flex items-center gap-1 text-[12px] font-medium text-primary"
        >
          <i
            className={cn(
              'ti ti-chevron-down text-[14px] transition-transform',
              showAll && 'rotate-180',
            )}
            aria-hidden="true"
          />
          {showAll ? 'Hide older activity' : `Show older activity (${older})`}
        </button>
      ) : null}
    </section>
  );
}

const STATUS_LABEL: Record<string, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  awaiting_input: 'Awaiting input',
  on_hold: 'On hold',
  completed: 'Completed',
};

const PRIORITY_LABEL: Record<string, string> = {
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  urgent: 'Urgent',
};

function describeEvent(type: string, payload: Record<string, unknown> | null): string {
  if (!payload) payload = {};
  switch (type) {
    case 'task_created':
      return 'created this task';
    case 'status_changed':
      return `changed status to ${STATUS_LABEL[String(payload.to)] ?? String(payload.to)}`;
    case 'priority_changed':
      return `changed priority to ${PRIORITY_LABEL[String(payload.to)] ?? String(payload.to)}`;
    case 'description_updated':
      return 'updated the description';
    case 'latest_status_updated':
      return 'updated the latest status';
    case 'js_comment_updated':
      return 'updated the JS comment';
    case 'due_date_changed':
      return payload.to
        ? `set the due date to ${payload.to}`
        : 'cleared the due date';
    case 'visibility_changed':
      return `set visibility to ${String(payload.to)}`;
    case 'subdivision_changed':
      return payload.to
        ? `moved this task to the ${String(payload.to)} sub-division`
        : 'removed this task from its sub-division';
    case 'pmu_team_shared':
      return 'shared this task with the entire PMU team';
    case 'pmu_team_unshared':
      return 'stopped sharing this task with the PMU team';
    case 'milestone_toggled':
      return payload.milestone ? 'marked as milestone' : 'unmarked as milestone';
    case 'subtask_added':
      return `added subtask "${String(payload.name ?? '')}"`;
    case 'subtask_completed':
      return `completed subtask "${String(payload.name ?? '')}"`;
    case 'subtask_reopened':
      return `reopened subtask "${String(payload.name ?? '')}"`;
    case 'subtask_updated': {
      const name = String(payload.name ?? '');
      const changes = Array.isArray(payload.changes) ? (payload.changes as string[]) : [];
      const reassigned = changes.includes('reassigned');
      const deadline = changes.includes('deadline updated');
      if (reassigned && payload.toName) {
        const to = String(payload.toName);
        return deadline
          ? `reassigned subtask "${name}" to ${to} and updated its deadline`
          : `reassigned subtask "${name}" to ${to}`;
      }
      if (deadline) return `updated the deadline of subtask "${name}"`;
      return `updated subtask "${name}"`;
    }
    case 'task_archived':
      return 'archived this task';
    case 'task_transferred':
      return `transferred this task to ${String(payload.toName ?? '')}`;
    case 'owner_changed':
      return `reassigned this task to ${String(payload.toName ?? '')}`;
    case 'task_renamed':
      return `renamed this task to "${String(payload.to ?? '')}"`;
    case 'task_read':
      return 'read this task';
    case 'subtask_read':
      return `read subtask "${String(payload.subtaskName ?? '')}"`;
    default:
      return type.replace(/_/g, ' ');
  }
}

/**
 * Events where an exact date and time matters more than a relative phrase:
 * read receipts, and ownership/assignment changes (task transfer or
 * reassignment, subtask reassignment) — so the log states plainly who
 * handed a task or subtask to whom, and exactly when.
 */
function showsAbsoluteTime(type: string): boolean {
  return (
    type === 'task_read' ||
    type === 'subtask_read' ||
    type === 'task_transferred' ||
    type === 'owner_changed' ||
    type === 'subtask_updated'
  );
}

function isAccent(type: string): boolean {
  return type === 'status_changed' || type === 'js_priority_changed';
}
