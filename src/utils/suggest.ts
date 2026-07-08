/** Classic Levenshtein edit distance between two strings. */
function levenshtein(a: string, b: string): number {
  const rows = a.length + 1;
  const cols = b.length + 1;
  const dp: number[][] = Array.from({ length: rows }, (_, i) => [i, ...new Array(cols - 1).fill(0)]);
  for (let j = 0; j < cols; j++) dp[0][j] = j;

  for (let i = 1; i < rows; i++) {
    for (let j = 1; j < cols; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      dp[i][j] = Math.min(
        dp[i - 1][j] + 1, // deletion
        dp[i][j - 1] + 1, // insertion
        dp[i - 1][j - 1] + cost // substitution
      );
    }
  }

  return dp[rows - 1][cols - 1];
}

/**
 * Returns the candidate closest to `input` by edit distance, but only when it's plausibly a
 * typo — within 3 edits or half the input's length, whichever is larger. Returns undefined
 * rather than a misleading suggestion for wildly different names.
 */
export function closestMatch(input: string, candidates: string[]): string | undefined {
  if (candidates.length === 0) return undefined;

  const threshold = Math.max(3, Math.floor(input.length / 2));
  let best: { candidate: string; distance: number } | undefined;

  for (const candidate of candidates) {
    const distance = levenshtein(input, candidate);
    if (!best || distance < best.distance) {
      best = { candidate, distance };
    }
  }

  return best && best.distance <= threshold ? best.candidate : undefined;
}
