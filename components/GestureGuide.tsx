"use client";

import { useState } from "react";

interface GestureGuideProps {
  visible: boolean;
  onClose: () => void;
}

interface GestureInfo {
  gesture: string;
  icon: string;
  description: string;
  keyboardEquiv: string;
}

const GESTURES: GestureInfo[] = [
  {
    gesture: "Pinch + Drag",
    icon: "🤏",
    description: "Move focus between panels and items. Scrub horizontally to switch panels.",
    keyboardEquiv: "← → ↑ ↓ or Tab",
  },
  {
    gesture: "Two-Hand Pinch (Spread/Close)",
    icon: "🤲",
    description: "Zoom into a data view to see expanded details. Spread to zoom in, close to zoom out.",
    keyboardEquiv: "Enter / Escape",
  },
  {
    gesture: "Open Palm (Hold)",
    icon: "🖐",
    description: "Select the currently focused panel or device. Hold for 0.5 seconds.",
    keyboardEquiv: "Enter or Space",
  },
  {
    gesture: "Fist",
    icon: "✊",
    description: "Cancel the current action or go back to the panel overview.",
    keyboardEquiv: "Escape",
  },
  {
    gesture: "Point + Hold",
    icon: "👆",
    description: "Toggle a specific IoT device directly by pointing at it. Hold for 0.5 seconds.",
    keyboardEquiv: "Space on focused device",
  },
];

export default function GestureGuide({ visible, onClose }: GestureGuideProps) {
  if (!visible) return null;

  return (
    <div
      className="gesture-guide-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Gesture Guide"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="gesture-guide" role="document">
        <div className="guide-header">
          <h2>Gesture Guide</h2>
          <button
            className="guide-close"
            onClick={onClose}
            aria-label="Close gesture guide"
            type="button"
          >
            ✕
          </button>
        </div>
        <p className="guide-intro">
          Use hand gestures via your webcam, or the keyboard equivalents listed below.
          Press <kbd>?</kbd> to toggle this guide.
        </p>
        <div className="gesture-list" role="list">
          {GESTURES.map((g) => (
            <div key={g.gesture} className="gesture-item" role="listitem">
              <div className="gesture-icon-large">{g.icon}</div>
              <div className="gesture-details">
                <h3 className="gesture-name">{g.gesture}</h3>
                <p className="gesture-desc">{g.description}</p>
                <div className="gesture-keyboard">
                  <span className="keyboard-label">Keyboard:</span>
                  <kbd>{g.keyboardEquiv}</kbd>
                </div>
              </div>
            </div>
          ))}
        </div>
        <div className="guide-footer">
          <p>All actions produce distinct audio feedback. Enable sound for the full experience.</p>
        </div>
      </div>
    </div>
  );
}
