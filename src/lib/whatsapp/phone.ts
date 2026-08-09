/**
 * Phone-number normalization for WhatsApp (Sandesha).
 *
 * User phone numbers are stored as bare 10-digit Indian mobiles
 * (see updateMyProfileSchema in src/app/actions/profile.ts). Sandesha wants
 * digits only, E.164 WITHOUT the leading '+', e.g. 919810904048. A bare
 * 10-digit number is accepted and auto-prefixed with 91, but we send the full
 * form so behaviour stays explicit.
 *
 * Returns null when the stored value isn't a number we can send to, so the
 * caller can mark that delivery failed rather than sending garbage.
 */
export function toWhatsAppNumber(phone: string | null | undefined): string | null {
  if (!phone) return null;
  const digits = phone.replace(/\D/g, '');
  // Bare 10-digit Indian mobile → prefix country code.
  if (/^[6-9]\d{9}$/.test(digits)) return `91${digits}`;
  // Already carries the 91 country code.
  if (/^91[6-9]\d{9}$/.test(digits)) return digits;
  return null;
}
