"use client";

import type { TrackerStatus } from "@/lib/handTracker";
import type { DiscreteGesture } from "@/lib/gestureClassifier";

interface CameraPreviewProps {
  videoRef: React.RefObject<HTMLVideoElement | null>;
  overlayRef: React.RefObject<HTMLCanvasElement | null>;
  cameraOn: boolean;
  status: TrackerStatus;
  gesture: DiscreteGesture;
}

const GESTURE_LABELS: Record<DiscreteGesture, string> = {
  open_palm: "✋ Open Palm",
  fist: "✊ Fist",
  point: "👆 Point",
  pinch: "🤏 Pinch",
  none: "— Idle",
};

const MODE_LABELS: Record<TrackerStatus["mode"], string> = {
  idle: "Standby",
  drag: "Dragging",
  zoom: "Zooming",
};

export default function CameraPreview({
  videoRef,
  overlayRef,
  cameraOn,
  status,
  gesture,
}: CameraPreviewProps) {
  if (!cameraOn) return null;

  return (
    <div className="camera-preview" aria-label="Camera preview">
      <video
        ref={videoRef}
        muted
        playsInline
        className="camera-video"
      />
      <canvas
        ref={overlayRef}
        width={208}
        height={156}
        className="camera-overlay"
      />
      <div className="camera-info">
        <span className="camera-hands">
          {status.hands > 0
            ? `${status.hands} hand${status.hands > 1 ? "s" : ""}`
            : "Show hands"}
        </span>
        <span className="camera-divider">·</span>
        <span className="camera-gesture">{GESTURE_LABELS[gesture]}</span>
        {status.mode !== "idle" && (
          <>
            <span className="camera-divider">·</span>
            <span className="camera-mode">{MODE_LABELS[status.mode]}</span>
          </>
        )}
      </div>
    </div>
  );
}
