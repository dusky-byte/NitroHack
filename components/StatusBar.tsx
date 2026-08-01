"use client";
import Link from "next/link";

import type { DiscreteGesture } from "@/lib/gestureClassifier";
import type { TrackerStatus } from "@/lib/handTracker";

interface StatusBarProps {
  cameraOn: boolean;
  cameraStarting: boolean;
  gesture: DiscreteGesture;
  gestureProgress: number; // 0..1 hold progress
  soundMuted: boolean;
  activePanel: number;
  onToggleCamera: () => void;
  onToggleMute: () => void;
  onShowGuide: () => void;
  voiceListening?: boolean;
  voiceTranscript?: string;
  onToggleVoice?: () => void;
}

const PANEL_NAMES = ["Data", "Devices", "Activity"];

const GESTURE_INFO: Record<DiscreteGesture, { label: string; cls: string }> = {
  open_palm: { label: "✋ Palm",  cls: "badge-palm"  },
  fist:      { label: "✊ Fist",  cls: "badge-fist"  },
  point:     { label: "👆 Point", cls: "badge-point" },
  pinch:     { label: "🤏 Pinch", cls: "badge-pinch" },
  none:      { label: "— Idle",   cls: "badge-idle"  },
};

export default function StatusBar({
  cameraOn, cameraStarting, gesture, gestureProgress,
  soundMuted, activePanel,
  onToggleCamera, onToggleMute, onShowGuide,
  voiceListening = false, voiceTranscript = "", onToggleVoice
}: StatusBarProps) {
  const info = GESTURE_INFO[gesture];
  const showProgress = gestureProgress > 0 && gestureProgress < 1 && cameraOn;

  return (
    <header className="status-bar" role="banner">
      <div className="status-left">
        <h1 className="brand">
          <span className="brand-ultra">Ultra</span><span className="brand-touch">Touch</span>
        </h1>
        <nav className="panel-tabs" role="tablist" aria-label="Panels">
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
        </nav>
      </div>

      <div className="status-center">
        {cameraOn && (
          <div className="gesture-badge-wrap">
            <span className={`gesture-badge ${info.cls}`} aria-live="polite">
              {info.label}
            </span>
            {showProgress && (
              <div className="hold-ring-track" aria-hidden="true">
                <svg width="36" height="36" viewBox="0 0 36 36">
                  <circle
                    cx="18" cy="18" r="14"
                    fill="none"
                    stroke="rgba(56,189,248,0.15)"
                    strokeWidth="2.5"
                  />
                  <circle
                    cx="18" cy="18" r="14"
                    fill="none"
                    stroke="#38bdf8"
                    strokeWidth="2.5"
                    strokeDasharray={`${gestureProgress * 87.96} 87.96`}
                    strokeLinecap="round"
                    transform="rotate(-90 18 18)"
                    style={{ transition: "stroke-dasharray 0.05s linear" }}
                  />
                </svg>
              </div>
            )}
          </div>
        )}
      </div>

      <div className="status-right">
        {onToggleVoice && (
          <button 
            className={`status-btn ${voiceListening ? "active voice-active" : ""}`} 
            onClick={onToggleVoice} 
            aria-label="Voice Command" 
            title="Voice Command" 
            type="button"
          >
            <span className="material-symbols-outlined">mic</span>
            {voiceListening && "..."}
          </button>
        )}
        {voiceListening && voiceTranscript && (
          <div className="voice-transcript" aria-live="polite">
            <span className="voice-transcript-text">{voiceTranscript}</span>
            <span className="voice-transcript-dot">●</span>
          </div>
        )}
        <Link href="/help" className="status-btn" title="Setup & Help" aria-label="Help">
          <span className="material-symbols-outlined">menu_book</span>
        </Link>
        <button className="status-btn" onClick={onShowGuide} aria-label="Gesture guide" title="Gesture guide (?)" type="button">
          <span className="material-symbols-outlined">help</span>
        </button>
        <button className="status-btn" onClick={onToggleMute} aria-label={soundMuted ? "Unmute" : "Mute"} aria-pressed={!soundMuted} title="Toggle sound (M)" type="button">
          <span className="material-symbols-outlined">{soundMuted ? "volume_off" : "volume_up"}</span>
        </button>
        <button
          className={`status-btn camera-btn ${cameraOn ? "active" : ""}`}
          onClick={onToggleCamera}
          disabled={cameraStarting}
          aria-label={cameraOn ? "Disable camera" : "Enable gesture camera"}
          aria-pressed={cameraOn}
          title="Toggle camera (G)"
          type="button"
        >
          <span className="material-symbols-outlined" style={{ marginRight: 4 }}>{cameraOn ? "videocam" : "videocam_off"}</span>
          {cameraOn ? "On" : "Off"}
        </button>
      </div>
    </header>
  );
}
