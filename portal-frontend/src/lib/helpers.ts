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

/** Update a single search param while preserving all others (act_as, deep links, etc.) */
export function updateSearchParam(key: string, value: string): URLSearchParams {
  const params = new URLSearchParams(window.location.search);
  params.set(key, value);
  return params;
}

/** Title-case a string: "SMITH 1-24H" → "Smith 1-24h" */
export function titleCase(str: string | null | undefined): string {
  if (!str) return '';
  return str.toLowerCase().replace(/(?:^|\s)\S/g, (c) => c.toUpperCase());
}

/** Format TRS display: "24N-12W-08" (Township-Range-Section) */
export function formatTRS(sec?: string, twn?: string, rng?: string): string {
  const parts: string[] = [];
  if (twn) parts.push(twn);
  if (rng) parts.push(rng);
  if (sec) parts.push(String(sec).padStart(2, '0'));
  return parts.join('-');
}

/** Get well status color by code */
export function getWellStatusColor(status: string | null | undefined): string {
  if (!status) return '#64748b';
  // Inline lookup to avoid circular import with constants
  const colors: Record<string, string> = {
    AC: '#10b981', ACTIVE: '#10b981', PA: '#ef4444', PLUGGED: '#ef4444',
    IN: '#f59e0b', INACTIVE: '#f59e0b', SI: '#8b5cf6', 'SHUT-IN': '#8b5cf6',
    TA: '#6366f1', 'TEMP ABANDON': '#6366f1', NEW: '#3b82f6', NR: '#6b7280',
  };
  return colors[status.toUpperCase()] || '#64748b';
}

/** Check if well name indicates horizontal */
export function isHorizontalWell(name: string | null | undefined): boolean {
  if (!name) return false;
  return /\d+[hH]\b|\bH[zZ]?\b|\bHORIZ/i.test(name);
}

/** Format number with commas: 12345 → "12,345" */
export function formatNumber(n: number | null | undefined): string {
  if (n === null || n === undefined) return '\u2014';
  return n.toLocaleString('en-US');
}

/** Format phone number for display */
export function formatPhone(phone: string | null | undefined): string {
  if (!phone) return '';
  const digits = phone.replace(/\D/g, '');
  if (digits.length === 10) {
    return `(${digits.slice(0, 3)}) ${digits.slice(3, 6)}-${digits.slice(6)}`;
  }
  return phone;
}
