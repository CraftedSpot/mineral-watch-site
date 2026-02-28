/**
 * Parallel batch execution with bounded concurrency.
 *
 * Processes items in batches, running up to `concurrency` batches simultaneously.
 * Prevents D1 query serialization bottleneck without overwhelming the Workers isolate.
 */

/**
 * Execute batched async operations with bounded parallelism.
 *
 * @param items       Full list of items to process
 * @param batchSize   Number of items per batch
 * @param fn          Async function that processes one batch and returns results
 * @param concurrency Max number of concurrent batches (default 6)
 * @returns           Flattened array of all batch results
 */
export async function parallelBatches<T, R>(
  items: T[],
  batchSize: number,
  fn: (batch: T[]) => Promise<R[]>,
  concurrency: number = 6
): Promise<R[]> {
  if (items.length === 0) return [];

  const batches: T[][] = [];
  for (let i = 0; i < items.length; i += batchSize) {
    batches.push(items.slice(i, i + batchSize));
  }

  // If total batches fit in one wave, just Promise.all
  if (batches.length <= concurrency) {
    const waveResults = await Promise.all(batches.map(fn));
    return waveResults.flat();
  }

  // Process in waves of `concurrency`
  const allResults: R[] = [];
  for (let i = 0; i < batches.length; i += concurrency) {
    const wave = batches.slice(i, i + concurrency);
    const waveResults = await Promise.all(wave.map(fn));
    for (const results of waveResults) {
      allResults.push(...results);
    }
  }
  return allResults;
}
