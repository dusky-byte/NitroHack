"use client";

import type { DiscreteGesture } from "@/lib/gestureClassifier";

interface StatusBarProps {
  cameraOn: boolean;
  cameraStarting: boolean;
  gesture: DiscreteGesture;
  soundMuted: boolean;
  activePanel: number;
  onToggleCamera: () => void;
  onToggleMute: () => void;
  onShowGuide: () => void;
}

const PANEL_NAMES = ["Data", "Devices", "Activity"];

const GESTURE_BADGE: Record<DiscreteGesture, { label: string; className: string }> = {
  open_palm: { label: "✋ Palm", className: "badge-palm" },
  fist: { label: "✊ Fist", className: "badge-fist" },
  point: { label: "👆 Point", className: "badge-point" },
  pinch: { label: "🤏 Pinch", className: "badge-pinch" },
  none: { label: "— Idle", className: "badge-idle" },
};

export default function StatusBar({
  cameraOn,
  cameraStarting,
  gesture,
  soundMuted,
  activePanel,
  onToggleCamera,
  onToggleMute,
  onShowGuide,
}: StatusBarProps) {
  const badge = GESTURE_BADGE[gesture];

  return (
    <header className="status-bar" role="banner">
      <div className="status-left">
        <h1 className="brand">
          <span className="brand-ultra">Ultra</span>
          <span className="brand-touch">Touch</span>
        </h1>
        <div className="panel-tabs" role="tablist" aria-label="Active panel">
          {PANEL_NAMES.map((name, i) => (
            <span
              key={name}
              className={`panel-tab ${i === activePanel ? "active" : ""}`}
              role="tab"
              aria-selected={i === activePanel}
            >
              {name}
            </span>
          ))}
        </div>
      </div>

      <div className="status-center">
        {cameraOn && (
          <span className={`gesture-badge ${badge.className}`} aria-live="polite">
            {badge.label}
          </span>
        )}
      </div>

      <div className="status-right">
        <button
          className="status-btn"
          onClick={onShowGuide}
          aria-label="Show gesture guide"
          title="Gesture guide (?)"
          type="button"
        >
          ?
        </button>
        <button
          className="status-btn"
          onClick={onToggleMute}
          aria-label={soundMuted ? "Unmute sounds" : "Mute sounds"}
          aria-pressed={!soundMuted}
          title="Toggle sound"
          type="button"
        >
          {soundMuted ? "🔇" : "🔊"}
        </button>
        <button
          className={`status-btn camera-btn ${cameraOn ? "active" : ""}`}
          onClick={onToggleCamera}
          disabled={cameraStarting}
          aria-label={cameraOn ? "Disable camera" : "Enable camera"}
          aria-pressed={cameraOn}
          title="Toggle camera (G)"
          type="button"
        >
          {cameraStarting ? "⏳" : cameraOn ? "📹" : "📷"}
        </button>
      </div>
    </header>
  );
}
