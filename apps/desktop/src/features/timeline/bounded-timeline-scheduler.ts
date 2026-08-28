export interface TimelineSchedulerHost {
  readonly setTimeout: typeof window.setTimeout;
  readonly clearTimeout: typeof window.clearTimeout;
  readonly requestAnimationFrame: typeof window.requestAnimationFrame;
  readonly cancelAnimationFrame: typeof window.cancelAnimationFrame;
}

export class BoundedTimelineScheduler {
  private readonly timeouts = new Map<string, number>();
  private readonly animationFrames = new Map<string, number>();

  constructor(private readonly host: TimelineSchedulerHost = window) {}

  scheduleTimeout(key: string, callback: () => void, delayMs: number): void {
    this.cancelTimeout(key);
    const timerId = this.host.setTimeout(() => {
      if (this.timeouts.get(key) !== timerId) return;
      this.timeouts.delete(key);
      callback();
    }, delayMs);
    this.timeouts.set(key, timerId);
  }

  scheduleAnimationFrame(key: string, callback: () => void): void {
    this.cancelAnimationFrame(key);
    const frameId = this.host.requestAnimationFrame(() => {
      if (this.animationFrames.get(key) !== frameId) return;
      this.animationFrames.delete(key);
      callback();
    });
    this.animationFrames.set(key, frameId);
  }

  cancelTimeout(key: string): void {
    const timerId = this.timeouts.get(key);
    if (timerId === undefined) return;
    this.host.clearTimeout(timerId);
    this.timeouts.delete(key);
  }

  cancelAnimationFrame(key: string): void {
    const frameId = this.animationFrames.get(key);
    if (frameId === undefined) return;
    this.host.cancelAnimationFrame(frameId);
    this.animationFrames.delete(key);
  }

  cancelAll(): void {
    for (const timerId of this.timeouts.values()) this.host.clearTimeout(timerId);
    for (const frameId of this.animationFrames.values()) this.host.cancelAnimationFrame(frameId);
    this.timeouts.clear();
    this.animationFrames.clear();
  }

  pendingCount(): number {
    return this.timeouts.size + this.animationFrames.size;
  }
}
