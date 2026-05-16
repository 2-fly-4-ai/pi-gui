import { sessionKey } from "@pi-gui/pi-sdk-driver";
import type { SessionDriverEvent, SessionRef } from "@pi-gui/session-driver";

type AssistantDeltaEvent = Extract<SessionDriverEvent, { type: "assistantDelta" }>;

interface PendingAssistantDelta {
  event: AssistantDeltaEvent;
  text: string;
}

export class AssistantDeltaBatcher {
  private readonly pendingBySession = new Map<string, PendingAssistantDelta>();
  private timer: NodeJS.Timeout | undefined;

  constructor(
    private readonly flushDelayMs: number,
    private readonly requestFlush: () => void,
  ) {}

  enqueue(event: AssistantDeltaEvent): void {
    const key = sessionKey(event.sessionRef);
    const pending = this.pendingBySession.get(key);
    if (pending) {
      pending.text += event.text;
      pending.event = {
        ...event,
        text: pending.text,
      };
    } else {
      this.pendingBySession.set(key, {
        event,
        text: event.text,
      });
    }
    this.scheduleFlush();
  }

  takeFor(sessionRef: SessionRef): AssistantDeltaEvent[] {
    const key = sessionKey(sessionRef);
    const pending = this.pendingBySession.get(key);
    if (!pending) {
      return [];
    }
    this.pendingBySession.delete(key);
    this.clearTimerIfIdle();
    return [pending.event];
  }

  takeAll(): AssistantDeltaEvent[] {
    if (this.pendingBySession.size === 0) {
      return [];
    }
    const events = Array.from(this.pendingBySession.values(), (pending) => pending.event);
    this.pendingBySession.clear();
    this.clearTimerIfIdle();
    return events;
  }

  dispose(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = undefined;
    }
    this.pendingBySession.clear();
  }

  private scheduleFlush(): void {
    if (this.timer) {
      return;
    }
    this.timer = setTimeout(() => {
      this.timer = undefined;
      this.requestFlush();
    }, this.flushDelayMs);
  }

  private clearTimerIfIdle(): void {
    if (this.pendingBySession.size > 0 || !this.timer) {
      return;
    }
    clearTimeout(this.timer);
    this.timer = undefined;
  }
}
