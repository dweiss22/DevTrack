export async function mapWithConcurrency<T, R>(values: readonly T[], limit: number, work: (value: T, index: number) => Promise<R>) {
  const results = new Array<R>(values.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(Math.max(1, limit), values.length) }, async () => {
    while (true) {
      const index = next++;
      if (index >= values.length) return;
      results[index] = await work(values[index], index);
    }
  }));
  return results;
}
