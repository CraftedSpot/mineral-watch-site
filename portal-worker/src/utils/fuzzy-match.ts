/**
 * Fuzzy name matching utilities.
 * Ported from documents-worker/src/services/chain-edge-builder.ts
 */

export function relaxedNormalize(normalized: string): string {
  return normalized
    .replace(/&/g, ' ')
    .replace(/\b(and|the|of|a|an)\b/g, '')
    .replace(/\b(company|co|enterprises?|associates?|group|partners)\b/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function editDistance(a: string, b: string, maxDist: number): number {
  if (a === b) return 0;
  if (a.length === 0) return b.length;
  if (b.length === 0) return a.length;
  if (a.length > b.length) { const t = a; a = b; b = t; }
  const aLen = a.length;
  const bLen = b.length;
  if (bLen - aLen > maxDist) return maxDist + 1;

  const row = new Array(aLen + 1);
  for (let i = 0; i <= aLen; i++) row[i] = i;

  for (let j = 1; j <= bLen; j++) {
    let prev = row[0];
    row[0] = j;
    let rowMin = row[0];
    for (let i = 1; i <= aLen; i++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      const val = Math.min(row[i] + 1, row[i - 1] + 1, prev + cost);
      prev = row[i];
      row[i] = val;
      if (val < rowMin) rowMin = val;
    }
    if (rowMin > maxDist) return maxDist + 1;
  }
  return row[aLen];
}

function isOrderedTokenSubset(shorter: string[], longer: string[]): boolean {
  if (shorter.length < 2 || shorter.length >= longer.length) return false;
  let j = 0;
  for (let i = 0; i < longer.length && j < shorter.length; i++) {
    if (longer[i] === shorter[j]) j++;
  }
  return j === shorter.length;
}

export function fuzzyTokenMatch(
  normA: string,
  normB: string
): { matchType: 'token_subset' | 'edit_distance'; confidence: number } | null {
  const tokensA = normA.split(' ');
  const tokensB = normB.split(' ');

  // Strategy 1: Token subset
  if (tokensA.length !== tokensB.length) {
    const shorter = tokensA.length < tokensB.length ? tokensA : tokensB;
    const longer = tokensA.length < tokensB.length ? tokensB : tokensA;
    if (isOrderedTokenSubset(shorter, longer)) {
      return { matchType: 'token_subset', confidence: 0.6 };
    }
    return null;
  }

  // Strategy 2: Edit distance (same token count)
  let diffCount = 0;
  for (let i = 0; i < tokensA.length; i++) {
    if (tokensA[i] !== tokensB[i]) {
      diffCount++;
      if (diffCount > 1) return null;
      if (Math.min(tokensA[i].length, tokensB[i].length) < 4) return null;
      if (editDistance(tokensA[i], tokensB[i], 2) > 2) return null;
    }
  }

  if (diffCount === 1) {
    return { matchType: 'edit_distance', confidence: 0.5 };
  }
  return null;
}
