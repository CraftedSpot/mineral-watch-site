/**
 * Escape a value for safe interpolation into Airtable filterByFormula strings.
 *
 * Airtable formula strings use single quotes as delimiters.
 * A literal single quote inside a string is represented by doubling it: ' → ''
 */
export function escapeAirtableValue(value: string): string {
  return value.replace(/'/g, "''");
}
