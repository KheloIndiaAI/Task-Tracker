import path from 'node:path';

import { Font } from '@react-pdf/renderer';

/**
 * Registers the Manrope family (400/500/600/700) for @react-pdf/renderer.
 *
 * @react-pdf/renderer renders through its own layout/font engine (fontkit),
 * not a browser — it cannot reach Google Fonts at request time and only
 * accepts WOFF/TTF (fontkit has no Brotli support, so WOFF2 is out). The four
 * files here are the real Manrope static weights, sourced once for this
 * feature; keep them — they are the report's on-brand typography, not a
 * temporary asset.
 *
 * Guarded so repeated calls within the same server process (every report
 * request, and Next dev's module re-evaluation on edit) don't re-register
 * the family — @react-pdf/renderer has no idempotency check of its own.
 */
let registered = false;

export function registerReportFonts(): void {
  if (registered) return;
  registered = true;

  const dir = path.join(process.cwd(), 'src/lib/pdf/fonts');
  Font.register({
    family: 'Manrope',
    fonts: [
      { src: path.join(dir, 'Manrope-Regular.woff'), fontWeight: 400 },
      { src: path.join(dir, 'Manrope-Medium.woff'), fontWeight: 500 },
      { src: path.join(dir, 'Manrope-SemiBold.woff'), fontWeight: 600 },
      { src: path.join(dir, 'Manrope-Bold.woff'), fontWeight: 700 },
    ],
  });

  // react-pdf hyphenates by default, which breaks task names/comments at
  // arbitrary points using a dictionary tuned for prose. A report of names,
  // statuses and short comments reads better with plain word-wrapping.
  Font.registerHyphenationCallback((word) => [word]);
}
