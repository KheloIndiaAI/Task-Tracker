import type { PillPriorityTone, PillStatusTone } from '@/components/ui/Pill';

/**
 * Document Centre — client-safe constants and the pure access rule.
 *
 * Kept free of any server-only import (no prisma) so both client components
 * and the server data layer (src/lib/document-centre.ts) can share it — the
 * same split as visibility-rules.ts (pure) vs visibility.ts (db-backed).
 */

/**
 * The Document Centre is executive-only. Access is granted per user by a Super
 * Admin (the `can_access_document_centre` toggle on Users > Create / Edit) —
 * deliberately NOT tied to the division-scoped visibility engine, so a granted
 * user sees the shared workspace regardless of their home division. Super Admins
 * always have access. Every granted user gets the full Document Centre rights
 * (view, discuss, workflow, mentions, notifications).
 */
export function canAccessDocumentCentre(user: {
  isSuperAdmin: boolean;
  canAccessDocumentCentre: boolean;
}): boolean {
  return user.isSuperAdmin || user.canAccessDocumentCentre;
}

/**
 * The default desk accounts provisioned by `db:seed:document-centre` and
 * back-filled with the access flag by the add_document_centre_access migration.
 * Retained only as the seed's provisioning list — it is no longer the access
 * gate (that is now the per-user `can_access_document_centre` flag above).
 */
export const DOCUMENT_CENTRE_USERNAMES = ['osd.myas', 'osd.ss', 'osd.dgsai'] as const;

// ------------------------------------------------------------
// Urgency — replaces task priority. Reuses the existing priority Pill tones
// (status/priority have their own colours, outside the two-accent rule).
// ------------------------------------------------------------

export type DocumentUrgency = 'highly_urgent' | 'urgent' | 'normal';

export const URGENCY_LABEL: Record<DocumentUrgency, string> = {
  highly_urgent: 'Highly urgent',
  urgent: 'Urgent',
  normal: 'Normal',
};

/** Map urgency onto an existing priority Pill tone (red / orange / muted). */
export const URGENCY_TONE: Record<DocumentUrgency, PillPriorityTone> = {
  highly_urgent: 'urgent',
  urgent: 'high',
  normal: 'low',
};

/** Create-form / picker order — strongest first. */
export const URGENCY_OPTIONS: DocumentUrgency[] = ['highly_urgent', 'urgent', 'normal'];

// ------------------------------------------------------------
// Workflow badges — reuse existing status Pill tones.
// ------------------------------------------------------------

export const UNDER_REVIEW_TONE: PillStatusTone = 'in_progress';
export const AWAITING_INPUT_TONE: PillStatusTone = 'awaiting_input';
export const COMPLETED_TONE: PillStatusTone = 'completed';

// ------------------------------------------------------------
// Filters + sort
// ------------------------------------------------------------

export type DocFilter =
  | 'all'
  | 'under_review'
  | 'awaiting_input'
  | 'highly_urgent'
  | 'completed';

export const DOC_FILTERS: DocFilter[] = [
  'all',
  'under_review',
  'awaiting_input',
  'highly_urgent',
  'completed',
];

export const DOC_FILTER_LABEL: Record<DocFilter, string> = {
  all: 'All',
  under_review: 'Under review',
  awaiting_input: 'Awaiting input',
  highly_urgent: 'Highly urgent',
  completed: 'Completed',
};

export type DocSort = 'modified' | 'created' | 'alpha';

export const DOC_SORTS: DocSort[] = ['modified', 'created', 'alpha'];

export const DOC_SORT_LABEL: Record<DocSort, { label: string; hint: string }> = {
  modified: { label: 'Recently modified', hint: 'Latest activity first' },
  created: { label: 'Latest created', hint: 'Newest records first' },
  alpha: { label: 'A–Z', hint: 'By subject' },
};
