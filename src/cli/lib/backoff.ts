import chalk from 'chalk';

export function isRateLimitError(err: unknown): boolean {
  if (err instanceof Error) {
    const msg = err.message.toLowerCase();
    return msg.includes('429') || msg.includes('quota') || msg.includes('rate limit');
  }
  return false;
}

export async function withBackoff<T>(fn: () => Promise<T>, maxRetries = 5): Promise<T> {
  for (let attempt = 0; attempt <= maxRetries; attempt++) {
    try {
      return await fn();
    } catch (err) {
      if (isRateLimitError(err) && attempt < maxRetries) {
        const delayMs = Math.min(Math.pow(2, attempt) * 1000, 32_000);
        console.log(chalk.yellow(`  ⏳ Rate limited — retrying in ${delayMs / 1000}s (attempt ${attempt + 1}/${maxRetries})...`));
        await new Promise((r) => setTimeout(r, delayMs));
        continue;
      }
      throw err;
    }
  }
  throw new Error('Max retries exceeded');
}
