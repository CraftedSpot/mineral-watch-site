/**
 * Shared PUN and API number normalization utilities
 *
 * Used by OTC upload handlers, completion write-back, and validation.
 * Single source of truth — do not duplicate these functions elsewhere.
 */

/**
 * Normalize a PUN to 10-char base_pun format: XXX-XXXXXX
 * (county 3 digits, dash, lease zero-padded to 6 digits)
 *
 * Handles:
 * - Standard dashed PUNs: "043-226597-0-0000" → "043-226597"
 * - Short lease PUNs: "007-53485-1" → "007-053485"
 * - Dashless PUNs: "04322659700000" → "043-226597"
 *
 * For OTC data (always well-formatted), this produces the same result
 * as substring(0, 10). The value is defensive handling of non-OTC sources.
 */
export function normalizeBasePun(pun: string): string {
  const match = pun.match(/^(\d{3})-(\d+)/);
  if (match) {
    const county = match[1];
    const lease = match[2].substring(0, 6).padStart(6, '0');
    return `${county}-${lease}`;
  }
  // Fallback for dashless PUNs (e.g. from completions_daily)
  const digits = pun.replace(/[^0-9]/g, '');
  if (digits.length >= 9) {
    return `${digits.substring(0, 3)}-${digits.substring(3, 9)}`;
  }
  return pun.length >= 10 ? pun.substring(0, 10) : pun;
}

/**
 * Normalize an API number to 10-digit bare format.
 * Strips all non-digits, takes first 10.
 *
 * "35-153-22352" → "3515322352"
 * "3515322352-00" → "3515322352"
 */
export function normalizeApi(raw: string | null | undefined): string | null {
  if (!raw) return null;
  const digits = raw.replace(/[^0-9]/g, '');
  return digits.length >= 10 ? digits.substring(0, 10) : digits || null;
}
