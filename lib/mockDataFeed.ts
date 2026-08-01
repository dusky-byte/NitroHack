// ——————————————————————————————————————————————
// Mock live data feed for UltraTouch dashboard.
// Generates 6 system-health metrics with realistic random walks.
// Designed for easy swap: replace this class with a real WebSocket/REST
// client that satisfies the same Metric interface.
// ——————————————————————————————————————————————

export interface Metric {
  id: string;
  label: string;
  value: number;
  unit: string;
  trend: "up" | "down" | "stable";
  history: number[];
  min: number;
  max: number;
  icon: string;
}

export type DataFeedListener = (metrics: Metric[]) => void;

const HISTORY_LENGTH = 30;
const UPDATE_INTERVAL_MS = 1500;

interface MetricSeed {
  id: string;
  label: string;
  unit: string;
  min: number;
  max: number;
  start: number;
  volatility: number;
  icon: string;
}

const SEEDS: MetricSeed[] = [
  { id: "cpu", label: "CPU Load", unit: "%", min: 0, max: 100, start: 42, volatility: 5, icon: "⚡" },
  { id: "mem", label: "Memory", unit: "%", min: 0, max: 100, start: 61, volatility: 3, icon: "💾" },
  { id: "net", label: "Network", unit: "Mbps", min: 0, max: 1000, start: 340, volatility: 40, icon: "🌐" },
  { id: "conn", label: "Connections", unit: "", min: 0, max: 500, start: 127, volatility: 15, icon: "🔗" },
  { id: "latency", label: "Latency", unit: "ms", min: 1, max: 500, start: 28, volatility: 8, icon: "⏱" },
  { id: "errors", label: "Error Rate", unit: "/min", min: 0, max: 50, start: 2, volatility: 2, icon: "⚠" },
];

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function randomWalk(current: number, volatility: number, min: number, max: number): number {
  const delta = (Math.random() - 0.48) * volatility; // slight upward bias
  return clamp(current + delta, min, max);
}

function computeTrend(history: number[]): "up" | "down" | "stable" {
  if (history.length < 5) return "stable";
  const recent = history.slice(-5);
  const older = history.slice(-10, -5);
  if (older.length === 0) return "stable";
  const recentAvg = recent.reduce((a, b) => a + b, 0) / recent.length;
  const olderAvg = older.reduce((a, b) => a + b, 0) / older.length;
  const diff = recentAvg - olderAvg;
  const range = Math.max(1, Math.abs(olderAvg) * 0.05);
  if (diff > range) return "up";
  if (diff < -range) return "down";
  return "stable";
}

export class MockDataFeed {
  private metrics: Metric[];
  private listeners = new Set<DataFeedListener>();
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor() {
    this.metrics = SEEDS.map((s) => {
      const history: number[] = [];
      let v = s.start;
      for (let i = 0; i < HISTORY_LENGTH; i++) {
        v = randomWalk(v, s.volatility * 0.5, s.min, s.max);
        history.push(Math.round(v * 10) / 10);
      }
      return {
        id: s.id,
        label: s.label,
        unit: s.unit,
        value: history[history.length - 1],
        trend: computeTrend(history),
        history,
        min: s.min,
        max: s.max,
        icon: s.icon,
      };
    });
  }

  subscribe(listener: DataFeedListener): () => void {
    this.listeners.add(listener);
    // Immediately send current state
    listener([...this.metrics]);
    return () => this.listeners.delete(listener);
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.tick(), UPDATE_INTERVAL_MS);
  }

  stop(): void {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  getMetrics(): Metric[] {
    return [...this.metrics];
  }

  private tick(): void {
    const seed = SEEDS;
    this.metrics = this.metrics.map((m, i) => {
      const s = seed[i];
      const newVal = Math.round(randomWalk(m.value, s.volatility, s.min, s.max) * 10) / 10;
      const history = [...m.history.slice(-(HISTORY_LENGTH - 1)), newVal];
      return {
        ...m,
        value: newVal,
        history,
        trend: computeTrend(history),
      };
    });
    const snapshot = [...this.metrics];
    this.listeners.forEach((fn) => fn(snapshot));
  }
}
