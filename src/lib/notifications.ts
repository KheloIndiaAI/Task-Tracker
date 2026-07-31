/**
 * Notification rendering.
 *
 * One central place that turns a `(type, payload)` pair into the icon,
 * tone, copy, and click target shown in the bell dropdown and the full
 * /notifications page.
 *
 * Per PRD §7 every type listed in `NotificationType` should map to a
 * legible sentence-case line.
 */

export type DescribedNotification = {
  icon: string;
  /** Tailwind colour class for the icon */
  iconClass: string;
  /** Sentence-case line shown to the user */
  text: string;
  /** Where clicking the notification takes the user */
  href: string;
  /** Optional left-edge accent tone for the row */
  accent?: 'js' | 'urgent' | 'primary' | 'info';
};

const LANE_LABEL: Record<string, string> = {
  today: 'today',
  week: 'this week',
  month: 'this month',
  watchlist: 'watchlist',
};

const STATUS_LABEL: Record<string, string> = {
  not_started: 'Not started',
  in_progress: 'In progress',
  awaiting_input: 'Awaiting input',
  on_hold: 'On hold',
  completed: 'Completed',
};

export function describeNotification(
  type: string,
  payload: Record<string, unknown> | null | undefined,
): DescribedNotification {
  const p = payload ?? {};
  const taskHref = p.taskId ? `/tasks/${String(p.taskId)}` : '/tasks';

  // Task title, quoted inline where the payload carries one. Every
  // task-linked notification type below embeds this so the bell dropdown
  // and /notifications page both name the task, not just describe the event.
  const title = typeof p.taskName === 'string' ? p.taskName.trim() : '';

  switch (type) {
    case 'js_priority_added': {
      const lane = String(p.lane ?? '');
      const laneLabel = LANE_LABEL[lane] ?? lane;
      return {
        icon: 'ti-bookmark-filled',
        iconClass: 'text-accent',
        text: title
          ? `Added "${title}" to JS Priority — ${laneLabel}`
          : `Added to JS Priority — ${laneLabel}`,
        href: taskHref,
        accent: 'js',
      };
    }
    case 'task_assigned': {
      const by = typeof p.assignedByName === 'string' ? p.assignedByName.trim() : '';
      const what = title ? `"${title}"` : 'a task';
      // `reason` distinguishes the several situations that all emit a
      // `task_assigned` notification, so the bell (and the WhatsApp dispatcher,
      // which mirrors this map) can word each one distinctly. Older
      // notifications carry no reason and fall back to the plain "assigned" copy.
      const reason = typeof p.reason === 'string' ? p.reason : 'assigned';
      const WORDING: Record<string, { icon: string; withBy: string; noBy: string }> = {
        assigned: {
          icon: 'ti-user-plus',
          withBy: `${by} assigned ${what} to you`,
          noBy: `Assigned ${what} to you`,
        },
        reassigned: {
          icon: 'ti-user-plus',
          withBy: `${by} reassigned ${what} to you`,
          noBy: `${what} was reassigned to you`,
        },
        transferred: {
          icon: 'ti-transfer',
          withBy: `${by} transferred ${what} to you`,
          noBy: `${what} was transferred to you`,
        },
        subtask: {
          icon: 'ti-subtask',
          withBy: `${by} assigned you the subtask ${what}`,
          noBy: `You were assigned the subtask ${what}`,
        },
        collaborator: {
          icon: 'ti-users',
          withBy: `${by} added you as a collaborator on ${what}`,
          noBy: `You were added as a collaborator on ${what}`,
        },
        pmu_team_share: {
          icon: 'ti-users-group',
          withBy: `${by} shared ${what} with your PMU team`,
          noBy: `${what} was shared with your PMU team`,
        },
      };
      const w = WORDING[reason] ?? WORDING.assigned;
      return {
        icon: w.icon,
        iconClass: 'text-primary',
        text: by ? w.withBy : w.noBy,
        href: taskHref,
      };
    }
    case 'mention': {
      const by = typeof p.actorName === 'string' ? p.actorName.trim() : '';
      // A mention lives on a task, a Timeline File, or a document record; the
      // payload carries whichever it is, so link and title follow suit.
      const onTf = typeof p.timelineFileId === 'string';
      const onDoc = typeof p.documentId === 'string';
      const href = onDoc
        ? `/document-centre/${String(p.documentId)}`
        : onTf
          ? `/timeline-files/${String(p.timelineFileId)}`
          : taskHref;
      const label = onDoc
        ? typeof p.documentSubject === 'string'
          ? p.documentSubject.trim()
          : ''
        : onTf
          ? typeof p.tfSubject === 'string'
            ? p.tfSubject.trim()
            : ''
          : title;
      return {
        icon: 'ti-at',
        iconClass: 'text-primary',
        text: label
          ? `${by ? `${by} mentioned` : 'Mentioned'} you on "${label}"`
          : 'Mentioned you in a comment',
        href,
        accent: 'primary',
      };
    }
    case 'document_record_created':
    case 'document_discussion':
    case 'document_review_requested':
    case 'document_review_completed':
    case 'document_awaiting_input':
    case 'document_attachment_added':
    case 'document_drive_link_added': {
      const by = typeof p.actorName === 'string' ? p.actorName.trim() : '';
      const subject =
        typeof p.documentSubject === 'string' && p.documentSubject.trim()
          ? p.documentSubject.trim()
          : 'a record';
      const what = subject === 'a record' ? 'a record' : `"${subject}"`;
      const href = p.documentId ? `/document-centre/${String(p.documentId)}` : '/document-centre';
      const who = by ? `${by} ` : '';
      const DOC: Record<string, { icon: string; verb: string }> = {
        document_record_created: { icon: 'ti-file-plus', verb: 'added the record' },
        document_discussion: { icon: 'ti-messages', verb: 'commented on' },
        document_review_requested: { icon: 'ti-eye-check', verb: 'requested review of' },
        document_review_completed: { icon: 'ti-checks', verb: 'completed review of' },
        document_awaiting_input: { icon: 'ti-clock', verb: 'flagged input awaited on' },
        document_attachment_added: { icon: 'ti-paperclip', verb: 'attached a file to' },
        document_drive_link_added: { icon: 'ti-link', verb: 'added a link to' },
      };
      const d = DOC[type];
      return {
        icon: d.icon,
        iconClass: 'text-primary',
        text: `${who}${d.verb} ${what}`,
        href,
        accent: 'primary',
      };
    }
    case 'status_changed_on_my_task': {
      const to = String(p.to ?? '');
      const label = STATUS_LABEL[to] ?? to;
      return {
        icon: 'ti-refresh',
        iconClass: 'text-info',
        text: title ? `Status changed to ${label} on "${title}"` : `Status changed to ${label}`,
        href: taskHref,
        accent: 'info',
      };
    }
    case 'task_due_soon': {
      const when =
        p.bucket === 'today'
          ? 'is due today'
          : p.bucket === 'tomorrow'
            ? 'is due tomorrow'
            : 'is due within 24 hours';
      return {
        icon: 'ti-clock',
        iconClass: 'text-accent',
        text: title ? `"${title}" ${when}` : `Task ${when}`,
        href: taskHref,
        accent: 'js',
      };
    }
    case 'task_overdue':
      return {
        icon: 'ti-alert-triangle',
        iconClass: 'text-urgent',
        text: title ? `"${title}" is overdue` : 'Task is overdue',
        href: taskHref,
        accent: 'urgent',
      };
    case 'timeline_file_marked_to_division':
      return {
        icon: 'ti-file-stack',
        iconClass: 'text-primary',
        text: 'Timeline file marked to your division',
        href: p.timelineFileId ? `/timeline-files/${String(p.timelineFileId)}` : '/timeline-files',
        accent: 'primary',
      };
    case 'secretary_comment_on_timeline_file':
      return {
        icon: 'ti-quote',
        iconClass: 'text-primary',
        text: 'Secretary added a comment',
        href: p.timelineFileId ? `/timeline-files/${String(p.timelineFileId)}` : '/timeline-files',
        accent: 'primary',
      };
    case 'cross_division_status_change': {
      const to = String(p.to ?? '');
      const label = STATUS_LABEL[to] ?? to;
      return {
        icon: 'ti-refresh',
        iconClass: 'text-info',
        text: title
          ? `Status changed to ${label} on "${title}"`
          : 'Status changed on a cross-division task',
        href: taskHref,
      };
    }
    case 'reassignment_approval_requested':
      return {
        icon: 'ti-arrows-shuffle',
        iconClass: 'text-accent',
        text: title ? `Reassignment of "${title}" needs your approval` : 'Reassignment needs your approval',
        href: taskHref,
        accent: 'js',
      };
    case 'reassignment_approved':
      return {
        icon: 'ti-check',
        iconClass: 'text-success',
        text: title ? `Reassignment of "${title}" approved` : 'Reassignment approved',
        href: taskHref,
      };
    case 'reassignment_rejected':
      return {
        icon: 'ti-x',
        iconClass: 'text-urgent',
        text: title ? `Reassignment of "${title}" rejected` : 'Reassignment rejected',
        href: taskHref,
      };
    case 'task_transferred': {
      const from = String(p.fromName ?? '');
      const to = String(p.toName ?? '');
      const what = title ? `"${title}"` : 'a task';
      return {
        icon: 'ti-transfer',
        iconClass: 'text-info',
        text: `${from} transferred ${what} to ${to}`,
        href: taskHref,
        accent: 'info',
      };
    }
    case 'task_pulled': {
      const puller = String(p.pulledByName ?? '');
      const what = title ? `"${title}"` : 'your task';
      return {
        icon: 'ti-git-pull-request',
        iconClass: 'text-info',
        text: `${puller} pulled ${what}`,
        href: taskHref,
        accent: 'info',
      };
    }
    case 'password_reset_by_admin':
      return {
        icon: 'ti-lock-cog',
        iconClass: 'text-primary',
        text: 'Your password was reset by Super Admin',
        href: '/profile/change-password',
        accent: 'primary',
      };
    case 'division_access_delegated': {
      const division = String(p.divisionName ?? 'a division');
      const from = String(p.delegatedByName ?? 'A division head');
      const to = String(p.delegatedToName ?? 'a user');
      const window = typeof p.windowLabel === 'string' ? ` (${p.windowLabel})` : '';
      const isDelegate = p.audience === 'delegate';
      return {
        icon: 'ti-key',
        iconClass: 'text-primary',
        text: isDelegate
          ? `${from} delegated ${division} access to you${window}`
          : `${from} delegated ${division} access to ${to}${window}`,
        href: isDelegate ? '/tasks' : '/admin/structure',
        accent: 'primary',
      };
    }
    case 'division_access_delegation_revoked': {
      const division = String(p.divisionName ?? 'a division');
      const to = String(p.delegatedToName ?? 'a user');
      const by = String(p.revokedByName ?? 'The division head');
      const isDelegate = p.audience === 'delegate';
      return {
        icon: 'ti-key-off',
        iconClass: 'text-hold',
        text: isDelegate
          ? `${by} revoked your ${division} access`
          : `${by} revoked ${to}'s ${division} access`,
        href: isDelegate ? '/tasks' : '/admin/structure',
      };
    }
    case 'comment_on_my_task': {
      const by = typeof p.actorName === 'string' ? p.actorName.trim() : '';
      return {
        icon: 'ti-message-circle',
        iconClass: 'text-primary',
        text: title
          ? `${by ? `${by} commented` : 'New comment'} on "${title}"`
          : by
            ? `${by} commented on your task`
            : 'New comment on your task',
        href: taskHref,
        accent: 'primary',
      };
    }
    case 'timeline_file_due_soon': {
      const ref = typeof p.refNo === 'string' ? p.refNo.trim() : '';
      const subject = typeof p.subject === 'string' ? p.subject.trim() : '';
      const label = ref && subject ? `${ref} — ${subject}` : ref || subject;
      return {
        icon: 'ti-clock',
        iconClass: 'text-accent',
        // A Timeline File deadline is an amber signal, like its countdown pill.
        text: label ? `Timeline file ${label} is due soon` : 'A timeline file is due soon',
        href: p.timelineFileId ? `/timeline-files/${String(p.timelineFileId)}` : '/timeline-files',
        accent: 'js',
      };
    }
    default:
      return {
        icon: 'ti-bell',
        iconClass: 'text-ink-3',
        text: 'New notification',
        href: '/notifications',
      };
  }
}
