// Recently opened pages render without another round trip. Expired pages refresh in the background.
export function createDetailCache<T>(fetcher: (key: string) => Promise<T>, {
  now = Date.now, ttl = 60_000, capacity = 100,
}: { now?: () => number; ttl?: number; capacity?: number } = {}) {
  const saved = new Map<string, { value: T; fetchedAt: number }>();
  const pending = new Map<string, Promise<T>>();
  let generation = 0;
  function refresh(key: string) {
    const existing = pending.get(key);
    if (existing) return existing;
    const startedGeneration = generation;
    const task = Promise.resolve().then(() => fetcher(key)).then(value => {
      if (startedGeneration !== generation) return value;
      saved.delete(key);
      saved.set(key, { value, fetchedAt: now() });
      while (saved.size > capacity) saved.delete(saved.keys().next().value!);
      return value;
    }).finally(() => { if (pending.get(key) === task) pending.delete(key); });
    pending.set(key, task);
    return task;
  }
  return {
    async get(key: string): Promise<T> {
      const entry = saved.get(key);
      if (!entry) return refresh(key);
      saved.delete(key); saved.set(key, entry);
      if (now() - entry.fetchedAt >= ttl) void refresh(key).catch(() => {});
      return entry.value;
    },
    clear() { generation++; saved.clear(); pending.clear(); },
  };
}
