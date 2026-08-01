"use client";

import { useEffect, useRef, useState } from "react";
import type { Metric } from "@/lib/mockDataFeed";

interface DataPanelProps {
  metrics: Metric[];
  focusedMetric: number;
  expanded: boolean;
  onFocusMetric: (index: number) => void;
  onSelectMetric: (index: number) => void;
}

function Sparkline({ data, min, max }: { data: number[]; min: number; max: number }) {
  if (data.length < 2) return null;
  const w = 80;
  const h = 28;
  const range = max - min || 1;
  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      className="sparkline"
      aria-hidden="true"
    >
      <polyline
        points={points}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="1.5"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

function trendArrow(trend: "up" | "down" | "stable"): string {
  switch (trend) {
    case "up": return "▲";
    case "down": return "▼";
    case "stable": return "—";
  }
}

function trendClass(trend: "up" | "down" | "stable"): string {
  switch (trend) {
    case "up": return "trend-up";
    case "down": return "trend-down";
    case "stable": return "trend-stable";
  }
}

export default function DataPanel({
  metrics,
  focusedMetric,
  expanded,
  onFocusMetric,
  onSelectMetric,
}: DataPanelProps) {
  const listRef = useRef<HTMLDivElement>(null);

  // Keyboard navigation within the panel
  useEffect(() => {
    const el = listRef.current;
    if (!el) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown" || e.key === "ArrowRight") {
        e.preventDefault();
        onFocusMetric(Math.min(focusedMetric + 1, metrics.length - 1));
      } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
        e.preventDefault();
        onFocusMetric(Math.max(focusedMetric - 1, 0));
      } else if (e.key === "Enter" || e.key === " ") {
        e.preventDefault();
        onSelectMetric(focusedMetric);
      }
    };
    el.addEventListener("keydown", onKey);
    return () => el.removeEventListener("keydown", onKey);
  }, [focusedMetric, metrics.length, onFocusMetric, onSelectMetric]);

  // If expanded, show a single expanded metric
  if (expanded && metrics[focusedMetric]) {
    const m = metrics[focusedMetric];
    return (
      <div className="data-panel expanded" role="region" aria-label="Data Dashboard — Expanded View">
        <div className="metric-expanded">
          <div className="metric-expanded-header">
            <span className="metric-icon">{m.icon}</span>
            <h3>{m.label}</h3>
            <span className={`metric-trend ${trendClass(m.trend)}`}>
              {trendArrow(m.trend)}
            </span>
          </div>
          <div className="metric-expanded-value">
            <span className="big-value">{m.value}</span>
            <span className="big-unit">{m.unit}</span>
          </div>
          <div className="metric-expanded-chart">
            <ExpandedChart data={m.history} min={m.min} max={m.max} />
          </div>
          <div className="metric-range" aria-hidden="true">
            <span>{m.min}{m.unit}</span>
            <span>{m.max}{m.unit}</span>
          </div>
        </div>
        <div aria-live="polite" className="sr-only">
          {m.label}: {m.value} {m.unit}, trend {m.trend}
        </div>
      </div>
    );
  }

  return (
    <div
      className="data-panel"
      role="region"
      aria-label="Data Dashboard"
      ref={listRef}
      tabIndex={0}
    >
      <h2 className="panel-title">Live Data</h2>
      <div className="metric-grid" role="list">
        {metrics.map((m, i) => (
          <div
            key={m.id}
            className={`metric-card ${i === focusedMetric ? "focused" : ""}`}
            role="listitem"
            tabIndex={i === focusedMetric ? 0 : -1}
            aria-label={`${m.label}: ${m.value} ${m.unit}, trend ${m.trend}`}
            onClick={() => onSelectMetric(i)}
            onMouseEnter={() => onFocusMetric(i)}
          >
            <div className="metric-header">
              <span className="metric-icon">{m.icon}</span>
              <span className="metric-label">{m.label}</span>
              <span className={`metric-trend ${trendClass(m.trend)}`}>
                {trendArrow(m.trend)}
              </span>
            </div>
            <div className="metric-body">
              <span className="metric-value">{m.value}</span>
              <span className="metric-unit">{m.unit}</span>
            </div>
            <Sparkline data={m.history} min={m.min} max={m.max} />
          </div>
        ))}
      </div>
      <div aria-live="polite" className="sr-only">
        {metrics[focusedMetric] &&
          `Focused: ${metrics[focusedMetric].label}, ${metrics[focusedMetric].value} ${metrics[focusedMetric].unit}`}
      </div>
    </div>
  );
}

function ExpandedChart({
  data,
  min,
  max,
}: {
  data: number[];
  min: number;
  max: number;
}) {
  const w = 260;
  const h = 100;
  const range = max - min || 1;

  const points = data
    .map((v, i) => {
      const x = (i / (data.length - 1)) * w;
      const y = h - ((v - min) / range) * h;
      return `${x},${y}`;
    })
    .join(" ");

  // Area fill
  const areaPoints = `0,${h} ${points} ${w},${h}`;

  return (
    <svg
      width={w}
      height={h}
      viewBox={`0 0 ${w} ${h}`}
      className="expanded-chart"
      aria-hidden="true"
    >
      <defs>
        <linearGradient id="chartGrad" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.3" />
          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.02" />
        </linearGradient>
      </defs>
      <polygon points={areaPoints} fill="url(#chartGrad)" />
      <polyline
        points={points}
        fill="none"
        stroke="var(--accent)"
        strokeWidth="2"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}
