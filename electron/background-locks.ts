/** User-owned shells and commands share a lease; other directory operations stay exclusive. */
export class BackgroundLocks {
  private directories = new Map<string, { count: number; release(): void }>();
  constructor(private lock: (cwd: string) => () => void) {}
  acquire = (cwd: string) => {
    let entry = this.directories.get(cwd);
    if (!entry) {
      entry = { count: 0, release: this.lock(cwd) };
      this.directories.set(cwd, entry);
    }
    entry.count++;
    let released = false;
    return () => {
      if (released) return;
      released = true;
      if (--entry.count === 0) {
        this.directories.delete(cwd);
        entry.release();
      }
    };
  };
}
