/**
 * Business Cards — client-safe constants and the pure access rule.
 *
 * Kept free of any server-only import (no prisma) so client components and the
 * server data layer (src/lib/business-cards.ts) can share it — the same split
 * as document-centre-shared.ts (pure) vs document-centre.ts (db-backed).
 */

/**
 * The Business Cards module is access-gated per user by a Super Admin (the
 * `can_access_business_cards` toggle on Users > Create / Edit). Deliberately NOT
 * tied to the division-scoped visibility engine — every granted user sees every
 * card (a shared workspace). Super Admins always have access.
 */
export function canAccessBusinessCards(user: {
  isSuperAdmin: boolean;
  canAccessBusinessCards: boolean;
}): boolean {
  return user.isSuperAdmin || user.canAccessBusinessCards;
}

/** A contact card as passed to client components (JSON-safe — dates are ISO). */
export type BusinessCardDto = {
  id: string;
  fullName: string;
  jobTitle: string | null;
  company: string;
  industry: string | null;
  email: string | null;
  mobile: string | null;
  remarks: string | null;
  eventName: string | null;
  createdByName: string;
  createdById: string;
  createdAt: string;
  hasAttachment: boolean;
};

/** A saved event (unique name) for the combobox + the event filter. */
export type BusinessCardEventDto = { id: string; name: string };

export const BUSINESS_CARD_MAX = {
  fullName: 160,
  jobTitle: 160,
  company: 200,
  industry: 120,
  email: 200,
  mobile: 60,
  remarks: 4000,
  eventName: 160,
} as const;
