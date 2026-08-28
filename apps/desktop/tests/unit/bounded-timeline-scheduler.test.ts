import { describe, expect, it, vi } from "vitest";
import {
  BoundedTimelineScheduler,
  type TimelineSchedulerHost,
} from "../../src/features/timeline/bounded-timeline-scheduler";

function createHost() {
  let nextId = 0;
  const timeouts = new Map<number, () => void>();
  const frames = new Map<number, () => void>();
  const host: TimelineSchedulerHost = {
    setTimeout: ((callback: TimerHandler) => {
      const id = ++nextId;
      timeouts.set(id, callback as () => void);
      return id;
    }) as typeof window.setTimeout,
    clearTimeout: ((id?: number) => {
      if (id !== undefined) timeouts.delete(id);
    }) as typeof window.clearTimeout,
    requestAnimationFrame: ((callback: FrameRequestCallback) => {
      const id = ++nextId;
      frames.set(id, () => callback(0));
      return id;
    }) as typeof window.requestAnimationFrame,
    cancelAnimationFrame: ((id: number) => frames.delete(id)) as typeof window.cancelAnimationFrame,
  };
  return { frames, host, timeouts };
}

describe("BoundedTimelineScheduler", () => {
  it("keeps only the newest callback for each logical timeout and frame", () => {
    const { frames, host, timeouts } = createHost();
    const scheduler = new BoundedTimelineScheduler(host);
    const stale = vi.fn();
    const current = vi.fn();

    scheduler.scheduleTimeout("follow", stale, 100);
    scheduler.scheduleTimeout("follow", current, 100);
    scheduler.scheduleAnimationFrame("restore", stale);
    scheduler.scheduleAnimationFrame("restore", current);

    expect(scheduler.pendingCount()).toBe(2);
    expect(timeouts.size).toBe(1);
    expect(frames.size).toBe(1);
    [...timeouts.values()][0]?.();
    [...frames.values()][0]?.();
    expect(stale).not.toHaveBeenCalled();
    expect(current).toHaveBeenCalledTimes(2);
    expect(scheduler.pendingCount()).toBe(0);
  });

  it("cancels every outstanding callback during teardown", () => {
    const { frames, host, timeouts } = createHost();
    const scheduler = new BoundedTimelineScheduler(host);
    scheduler.scheduleTimeout("one", vi.fn(), 100);
    scheduler.scheduleTimeout("two", vi.fn(), 200);
    scheduler.scheduleAnimationFrame("frame", vi.fn());

    scheduler.cancelAll();

    expect(timeouts.size).toBe(0);
    expect(frames.size).toBe(0);
    expect(scheduler.pendingCount()).toBe(0);
  });
});
