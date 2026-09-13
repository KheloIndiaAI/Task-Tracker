/**
 * Print-surface colours for the Priority Task Report.
 *
 * @react-pdf/renderer styles are plain JS objects, not CSS — the app's
 * token system (docs/COLOUR_TOKENS.css custom properties, Tailwind classes)
 * isn't reachable from here, so the light-theme token VALUES are restated
 * directly (a PDF has no dark mode). Division colour is not restated: it
 * comes straight from each division's own `avatarColour`, the same value
 * the live board already colours it by.
 */
export const REPORT_COLOURS = {
  page: '#ffffff', // --panel
  ink: '#1a1a1a', // --ink
  ink2: '#525252', // --ink-2
  ink3: '#8a8a8a', // --ink-3
  line: '#e8e6df', // --line
  line2: '#efedf0', // --line-2
} as const;

/**
 * A division's `avatarColour` as a soft background wash, for the report's
 * per-division section header. Mirrors the `${colour}${alphaHex}` wash
 * already used for a division tint elsewhere (UserProfilePopup.tsx), just
 * resolved to rgba() — the safest form across @react-pdf/renderer's colour
 * parser, which does not need to be trusted with 8-digit hex.
 */
export function divisionWash(hex: string, alpha: number): string {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) return REPORT_COLOURS.line2;
  const n = parseInt(match[1], 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}
