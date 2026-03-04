/** Format date for display: "1951-03-20" → "Mar 20, 1951" */
export function formatDate(d: string | null | undefined): string {
  if (!d) return '';
  return new Date(d + 'T00:00:00').toLocaleDateString('en-US', {
    month: 'short', day: 'numeric', year: 'numeric',
  });
}

/** Format decimal interest to 8 places */
export function formatDecimal(d: number | null | undefined): string {
  if (d === null || d === undefined) return '\u2014';
  return d.toFixed(8);
}

/** Truncate string with ellipsis */
export function truncate(s: string | null | undefined, len: number): string {
  if (!s) return '';
  return s.length > len ? s.slice(0, len - 1) + '\u2026' : s;
}
