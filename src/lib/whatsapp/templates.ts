/**
 * Maps an in-app notification (type + payload + resolved context) to a
 * Sandesha WhatsApp template name and its positional bodyParams.
 *
 * This MIRRORS src/lib/notification-context.ts `describeNotification` — the
 * same events, the same discriminators (`reason` on task_assigned, `bucket` on
 * task_due_soon) — but produces the Meta template variables instead of bell copy.
 *
 * Only the eleven approved templates are covered. A notification type/reason
 * with no template returns null and stays bell-only.
 *
 * Every returned value is a non-empty string: Meta rejects a blank positional
 * param with error 132000, so a missing due date becomes "No due date" and a
 * missing actor becomes a safe fallback rather than "".
 */

export type WhatsAppTemplate = { templateName: string; bodyParams: string[] };

/** Context resolved by the drain (task title/due/actor from the notification
 *  context helper, plus Timeline-File ref/subject). All fields optional. */
export type TemplateContext = {
  taskName?: string | null;
  dueDate?: Date | null;
  actorName?: string | null;
  tfRefNo?: string | null;
  tfSubject?: string | null;
};

const ACTOR_FALLBACK = 'A colleague';

/** "12 Aug 2026" in IST, or "No due date". Never empty. */
function formatDue(d: Date | null | undefined): string {
  if (!d) return 'No due date';
  return new Intl.DateTimeFormat('en-GB', {
    day: '2-digit',
    month: 'short',
    year: 'numeric',
    timeZone: 'Asia/Kolkata',
  }).format(d);
}

/** First non-empty trimmed string, else the fallback. */
function pick(fallback: string, ...vals: unknown[]): string {
  for (const v of vals) {
    if (typeof v === 'string' && v.trim().length > 0) return v.trim();
  }
  return fallback;
}

export function mapNotificationToTemplate(
  type: string,
  payload: Record<string, unknown>,
  ctx: TemplateContext = {},
): WhatsAppTemplate | null {
  const due = formatDue(ctx.dueDate ?? null);
  const task = pick('a task', ctx.taskName, payload.taskName);

  switch (type) {
    case 'task_assigned': {
      const reason = typeof payload.reason === 'string' ? payload.reason : 'assigned';
      const actor = pick(ACTOR_FALLBACK, ctx.actorName, payload.assignedByName, payload.actorName);
      switch (reason) {
        case 'transferred':
          return { templateName: 'task_transferred', bodyParams: [actor, task, due] };
        case 'reassigned':
          return { templateName: 'task_reassigned', bodyParams: [task, due] };
        case 'subtask':
          return { templateName: 'subtask_assigned', bodyParams: [task, due] };
        case 'collaborator':
          return { templateName: 'collaborator_added', bodyParams: [task] };
        case 'pmu_team_share':
          return null; // no approved template for PMU-team share — bell only
        default:
          return { templateName: 'task_assigned', bodyParams: [task, due] };
      }
    }

    // Standalone transfer notification (distinct from task_assigned·transferred).
    case 'task_transferred': {
      const actor = pick(ACTOR_FALLBACK, ctx.actorName, payload.fromName);
      return { templateName: 'task_transferred', bodyParams: [actor, task, due] };
    }

    case 'mention': {
      const actor = pick(ACTOR_FALLBACK, ctx.actorName, payload.actorName);
      // A mention may live on a task, a Timeline File, or a document record.
      const label = pick(task, payload.tfSubject, payload.documentSubject, ctx.tfSubject, ctx.taskName);
      return { templateName: 'task_mention', bodyParams: [actor, label] };
    }

    case 'comment_on_my_task': {
      const actor = pick(ACTOR_FALLBACK, ctx.actorName, payload.actorName);
      return { templateName: 'comment_on_task', bodyParams: [task, actor] };
    }

    case 'timeline_file_marked_to_division': {
      const ref = pick('a timeline file', ctx.tfRefNo, payload.refNo);
      return { templateName: 'tf_marked', bodyParams: [ref] };
    }

    case 'timeline_file_due_soon': {
      const ref = pick('a timeline file', payload.refNo, ctx.tfRefNo);
      const subject = pick(ref, payload.subject, ctx.tfSubject);
      return { templateName: 'tf_due_soon', bodyParams: [ref, subject] };
    }

    case 'task_due_soon': {
      if (payload.bucket === 'today') return { templateName: 'task_due_today', bodyParams: [task] };
      if (payload.bucket === 'tomorrow') return { templateName: 'task_due_tomorrow', bodyParams: [task] };
      return null; // generic "within 24h" has no dedicated template
    }

    default:
      return null;
  }
}

/** Notification types that CAN map to a WhatsApp template — used by the drain
 *  query to avoid scanning irrelevant rows. Keep in sync with the switch above. */
export const WHATSAPP_NOTIFICATION_TYPES = [
  'task_assigned',
  'task_transferred',
  'mention',
  'comment_on_my_task',
  'timeline_file_marked_to_division',
  'timeline_file_due_soon',
  'task_due_soon',
] as const;
