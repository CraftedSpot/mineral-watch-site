/**
 * Party name normalization — exact port from documents-worker/src/services/party-extraction.ts.
 * Must produce identical output so corrected names match the edge builder's indices.
 */
export function normalizePartyName(name: string): string {
  if (!name) return '';

  let n = name.trim();
  if (!n) return '';

  n = n.toLowerCase();

  // Strip honorifics
  n = n.replace(/\b(mr|mrs|ms|dr)\.?\s*/gi, '');

  // Strip corporate/legal suffixes (order: more specific first)
  n = n.replace(/\blimited\s+liability\s+(company|co\.?)\b/gi, '');
  n = n.replace(/\blimited\s+partnership\b/gi, '');
  n = n.replace(/\b(l\.l\.c\.?|llc)\b/gi, '');
  n = n.replace(/\b(l\.l\.p\.?|llp)\b/gi, '');
  n = n.replace(/\b(l\.p\.?)\b/gi, '');
  n = n.replace(/\bincorporated\b/gi, '');
  n = n.replace(/\binc\.?\b/gi, '');
  n = n.replace(/\bcorporation\b/gi, '');
  n = n.replace(/\bcorp\.?\b/gi, '');
  n = n.replace(/\bltd\.?\b/gi, '');
  n = n.replace(/\bCo\.\b/g, ''); // Case-sensitive period required — preserves "conoco"

  // Strip et al., et ux.
  n = n.replace(/\bet\s+al\.?\b/gi, '');
  n = n.replace(/\bet\s+ux\.?\b/gi, '');

  // Strip generational suffixes
  n = n.replace(/\b(jr|sr)\.?\b/gi, '');
  n = n.replace(/\b(iv|iii|ii)\b/gi, '');

  // Strip middle initials: single letter followed by optional period, surrounded by spaces
  // "John A. Smith" → "John Smith", but don't strip from "J. Paul Getty" (leading initial)
  n = n.replace(/(?<=\s)[a-z]\.?\s/gi, ' ');

  // Remove punctuation except hyphens and apostrophes
  n = n.replace(/[^a-z0-9\s\-']/g, '');

  // Collapse whitespace and trim
  n = n.replace(/\s+/g, ' ').trim();

  return n;
}
