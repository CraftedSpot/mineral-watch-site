/**
 * Generate Airtable-compatible record IDs for D1-first writes.
 * Format: 'rec' + 17 cryptographically random alphanumeric chars.
 * Uses crypto.getRandomValues() for collision safety at scale.
 */

const CHARS = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789';

export function generateRecordId(): string {
  const array = new Uint8Array(17);
  crypto.getRandomValues(array);
  let id = 'rec';
  for (let i = 0; i < 17; i++) {
    id += CHARS[array[i] % CHARS.length];
  }
  return id;
}
