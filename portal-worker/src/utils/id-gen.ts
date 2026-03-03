/**
 * Generate random record IDs with 'rec' prefix.
 * Legacy format from Airtable era, kept for consistency across all tables.
 * Not tied to Airtable — just a random string convention.
 * Format: 'rec' + 17 cryptographically random alphanumeric chars.
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
