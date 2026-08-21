export async function runWithConcurrency<T>(items: T[], limit: number, worker: (item: T) => Promise<void>) {
  const safeLimit = Math.max(1, Math.min(Math.floor(limit), items.length || 1));
  let cursor = 0;
  async function consume() {
    while (cursor < items.length) {
      const item = items[cursor++];
      await worker(item);
    }
  }
  await Promise.all(Array.from({ length: safeLimit }, consume));
}
