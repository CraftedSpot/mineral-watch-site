/**
 * Shared STR (Section/Township/Range) normalization utilities
 *
 * Used by property-link-counts, well-link-counts, and any handler
 * that needs consistent STR comparison.
 */

/**
 * Normalize township format for comparison
 * "7N" -> "7N", "7 N" -> "7N", "07N" -> "7N"
 */
export function normalizeTownship(twn: string | null): string | null {
  if (!twn) return null;
  const match = twn.toString().trim().toUpperCase().match(/^0*(\d{1,2})\s*([NS])$/);
  return match ? `${parseInt(match[1], 10)}${match[2]}` : twn.toUpperCase();
}

/**
 * Normalize range format for comparison
 * "4W" -> "4W", "4 W" -> "4W", "04W" -> "4W"
 */
export function normalizeRange(rng: string | null): string | null {
  if (!rng) return null;
  const match = rng.toString().trim().toUpperCase().match(/^0*(\d{1,2})\s*([EW])$/);
  return match ? `${parseInt(match[1], 10)}${match[2]}` : rng.toUpperCase();
}

/**
 * Normalize section to integer
 */
export function normalizeSection(sec: string | number | null): number | null {
  if (sec === null || sec === undefined) return null;
  const num = parseInt(sec.toString(), 10);
  return isNaN(num) ? null : num;
}

/**
 * Split an array into chunks of a given size
 */
export function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}
