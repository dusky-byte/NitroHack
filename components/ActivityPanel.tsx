"use client";

import { useEffect, useRef } from "react";

export interface ActivityEntry {
  id: string;
  timestamp: number;
  icon: string;
  description: string;
  type: "info" | "success" | "warning" | "error";
}

interface ActivityPanelProps {
  entries: ActivityEntry[];
  soundMuted: boolean;
  onToggleMute: () => void;
}

function formatTime(ts: number): string {
  const d = new Date(ts);
  return d.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

export default function ActivityPanel({
  entries,
  soundMuted,
  onToggleMute,
}: ActivityPanelProps) {
  const scrollRef = useRef<HTMLDivElement>(null);

  // Auto-scroll to bottom on new entries
  useEffect(() => {
    if (scrollRef.current) {
      scrollRef.current.scrollTop = scrollRef.current.scrollHeight;
    }
  }, [entries.length]);

  return (
    <div
      className="activity-panel"
      role="region"
      aria-label="Activity Log"
      tabIndex={0}
    >
      <div className="activity-header">
        <h2 className="panel-title">Activity</h2>
        <button
          className="sound-toggle"
          onClick={onToggleMute}
          aria-label={soundMuted ? "Unmute sounds" : "Mute sounds"}
          aria-pressed={!soundMuted}
          type="button"
        >
          {soundMuted ? "🔇" : "🔊"}
        </button>
      </div>

      {/* Audio visualizer bars */}
      <div className="audio-visualizer" aria-hidden="true">
        {Array.from({ length: 12 }).map((_, i) => (
          <div
            key={i}
            className="viz-bar"
            style={{
              animationDelay: `${i * 0.1}s`,
              opacity: soundMuted ? 0.15 : undefined,
            }}
          />
        ))}
      </div>

      {/* Log entries */}
      <div className="activity-log" ref={scrollRef} role="log" aria-live="polite">
        {entries.length === 0 && (
          <div className="activity-empty">No activity yet. Use gestures or keyboard to interact.</div>
        )}
        {entries.map((entry) => (
          <div
            key={entry.id}
            className={`activity-entry entry-${entry.type}`}
          >
            <span className="entry-time">{formatTime(entry.timestamp)}</span>
            <span className="entry-icon">{entry.icon}</span>
            <span className="entry-desc">{entry.description}</span>
          </div>
        ))}
      </div>

      <div aria-live="polite" className="sr-only">
        {entries.length > 0 && entries[entries.length - 1].description}
      </div>
    </div>
  );
}
