import type { BrowserWindow } from "electron";
import { getHeapStatistics } from "node:v8";
import { logIgnoredError } from "./diagnostics";

const DEFAULT_INTERVAL_MS = 15_000;
const REPEAT_PRESSURE_AFTER_MS = 60_000;

export type MemoryPressureLevel = "normal" | "warning" | "critical";

export interface MemoryPressureSample {
  readonly mainHeapRatio: number;
  readonly rendererHeapRatio: number;
}

export function classifyMemoryPressure(sample: MemoryPressureSample): MemoryPressureLevel {
  const ratio = Math.max(sample.mainHeapRatio, sample.rendererHeapRatio);
  if (ratio >= 0.85) return "critical";
  if (ratio >= 0.7) return "warning";
  return "normal";
}

export function startMemoryPressureGuard(options: {
  readonly getWindow: () => BrowserWindow | null;
  readonly onPressure: (level: Exclude<MemoryPressureLevel, "normal">) => Promise<void>;
  readonly intervalMs?: number;
}): () => void {
  let stopped = false;
  let sampleInFlight = false;
  let lastPressureLevel: MemoryPressureLevel = "normal";
  let lastPressureAt = 0;

  const sample = async () => {
    if (stopped || sampleInFlight) return;
    sampleInFlight = true;
    try {
      const pressure = classifyMemoryPressure(await readMemoryPressureSample(options.getWindow()));
      const now = Date.now();
      if (
        pressure !== "normal"
        && (
          pressure !== lastPressureLevel
          || now - lastPressureAt >= REPEAT_PRESSURE_AFTER_MS
        )
      ) {
        lastPressureAt = now;
        await options.onPressure(pressure);
      }
      lastPressureLevel = pressure;
    } catch (error) {
      logIgnoredError("memory-pressure-guard.sample", error);
    } finally {
      sampleInFlight = false;
    }
  };

  const timer = setInterval(() => {
    void sample();
  }, options.intervalMs ?? DEFAULT_INTERVAL_MS);
  timer.unref?.();

  return () => {
    stopped = true;
    clearInterval(timer);
  };
}

async function readMemoryPressureSample(window: BrowserWindow | null): Promise<MemoryPressureSample> {
  const mainHeap = process.memoryUsage().heapUsed;
  const mainHeapLimit = getHeapStatistics().heap_size_limit;
  let rendererHeapRatio = 0;
  if (window && !window.isDestroyed() && !window.webContents.isDestroyed()) {
    rendererHeapRatio = await window.webContents.executeJavaScript(`
      (() => {
        const memory = performance.memory;
        return memory && memory.jsHeapSizeLimit > 0
          ? memory.usedJSHeapSize / memory.jsHeapSizeLimit
          : 0;
      })()
    `).catch(() => 0) as number;
  }
  return {
    mainHeapRatio: mainHeapLimit > 0 ? mainHeap / mainHeapLimit : 0,
    rendererHeapRatio: Number.isFinite(rendererHeapRatio) ? rendererHeapRatio : 0,
  };
}
