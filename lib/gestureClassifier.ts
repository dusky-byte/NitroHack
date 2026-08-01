import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

// ——————————————————————————————————————————————
// Discrete gesture classifier for MediaPipe hand landmarks.
// Pure classification logic — no side effects, no DOM, no audio.
// ——————————————————————————————————————————————

export type DiscreteGesture = "open_palm" | "fist" | "point" | "pinch" | "none";

// MediaPipe hand landmark indices
const WRIST = 0;
const THUMB_CMC = 1;
const THUMB_MCP = 2;
const THUMB_IP = 3;
const THUMB_TIP = 4;
const INDEX_MCP = 5;
const INDEX_PIP = 6;
const INDEX_DIP = 7;
const INDEX_TIP = 8;
const MIDDLE_MCP = 9;
const MIDDLE_PIP = 10;
const MIDDLE_DIP = 11;
const MIDDLE_TIP = 12;
const RING_MCP = 13;
const RING_PIP = 14;
const RING_DIP = 15;
const RING_TIP = 16;
const PINKY_MCP = 17;
const PINKY_PIP = 18;
const PINKY_DIP = 19;
const PINKY_TIP = 20;

// Minimum consecutive frames a gesture must hold before we commit to it.
// Prevents single-frame flicker between states.
const HOLD_FRAMES = 3;

// Pinch threshold (thumb-to-index distance / hand scale)
const PINCH_THRESHOLD = 0.35;

/**
 * Check whether a finger is extended by comparing tip-to-wrist distance
 * vs PIP-to-wrist distance. If the tip is farther from the wrist than
 * the PIP joint, the finger is likely extended.
 */
function isFingerExtended(
  lm: NormalizedLandmark[],
  tip: number,
  pip: number,
  mcp: number,
): boolean {
  const tipToWrist = dist(lm[tip], lm[WRIST]);
  const pipToWrist = dist(lm[pip], lm[WRIST]);
  const mcpToWrist = dist(lm[mcp], lm[WRIST]);
  // Tip should be farther from wrist than PIP, and PIP farther than MCP
  return tipToWrist > pipToWrist && pipToWrist > mcpToWrist * 0.85;
}

/**
 * Check whether a finger is curled by comparing tip position to PIP position.
 * For a curled finger, the tip is closer to the wrist than the MCP.
 */
function isFingerCurled(
  lm: NormalizedLandmark[],
  tip: number,
  pip: number,
): boolean {
  const tipToWrist = dist(lm[tip], lm[WRIST]);
  const pipToWrist = dist(lm[pip], lm[WRIST]);
  return tipToWrist < pipToWrist;
}

function isThumbExtended(lm: NormalizedLandmark[]): boolean {
  const tipToWrist = dist(lm[THUMB_TIP], lm[WRIST]);
  const mcpToWrist = dist(lm[THUMB_MCP], lm[WRIST]);
  return tipToWrist > mcpToWrist * 1.1;
}

function dist(a: NormalizedLandmark, b: NormalizedLandmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y, a.z - b.z);
}

function dist2d(a: NormalizedLandmark, b: NormalizedLandmark): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * Classify a single hand's landmarks into a discrete gesture.
 * This is a pure function — no state, call it every frame.
 */
export function classifyGestureRaw(lm: NormalizedLandmark[]): DiscreteGesture {
  if (lm.length < 21) return "none";

  const handScale = dist2d(lm[WRIST], lm[MIDDLE_MCP]);
  if (handScale < 1e-6) return "none";

  // ─── PINCH: thumb tip close to index tip ───
  const pinchRatio = dist2d(lm[THUMB_TIP], lm[INDEX_TIP]) / handScale;
  if (pinchRatio < PINCH_THRESHOLD) {
    return "pinch";
  }

  // ─── Finger states ───
  const indexExtended = isFingerExtended(lm, INDEX_TIP, INDEX_PIP, INDEX_MCP);
  const middleExtended = isFingerExtended(lm, MIDDLE_TIP, MIDDLE_PIP, MIDDLE_MCP);
  const ringExtended = isFingerExtended(lm, RING_TIP, RING_PIP, RING_MCP);
  const pinkyExtended = isFingerExtended(lm, PINKY_TIP, PINKY_PIP, PINKY_MCP);
  const thumbExtended = isThumbExtended(lm);

  const indexCurled = isFingerCurled(lm, INDEX_TIP, INDEX_PIP);
  const middleCurled = isFingerCurled(lm, MIDDLE_TIP, MIDDLE_PIP);
  const ringCurled = isFingerCurled(lm, RING_TIP, RING_PIP);
  const pinkyCurled = isFingerCurled(lm, PINKY_TIP, PINKY_PIP);

  // ─── POINT: index extended, others curled ───
  if (indexExtended && middleCurled && ringCurled && pinkyCurled) {
    return "point";
  }

  // ─── FIST: all four fingers curled ───
  if (indexCurled && middleCurled && ringCurled && pinkyCurled) {
    return "fist";
  }

  // ─── OPEN PALM: all fingers extended ───
  if (indexExtended && middleExtended && ringExtended && pinkyExtended && thumbExtended) {
    return "open_palm";
  }

  return "none";
}

/**
 * Stateful gesture classifier with hysteresis.
 * Requires a gesture to be consistent for HOLD_FRAMES consecutive frames
 * before transitioning, preventing flicker.
 */
export class GestureClassifier {
  private currentGesture: DiscreteGesture = "none";
  private candidateGesture: DiscreteGesture = "none";
  private candidateFrames = 0;

  /** Process one frame of landmarks and return the stable gesture. */
  update(lm: NormalizedLandmark[]): DiscreteGesture {
    const raw = classifyGestureRaw(lm);

    if (raw === this.candidateGesture) {
      this.candidateFrames++;
    } else {
      this.candidateGesture = raw;
      this.candidateFrames = 1;
    }

    if (
      this.candidateGesture !== this.currentGesture &&
      this.candidateFrames >= HOLD_FRAMES
    ) {
      this.currentGesture = this.candidateGesture;
    }

    return this.currentGesture;
  }

  /** Get the current stable gesture without processing a new frame. */
  get gesture(): DiscreteGesture {
    return this.currentGesture;
  }

  /** Reset to idle state. */
  reset(): void {
    this.currentGesture = "none";
    this.candidateGesture = "none";
    this.candidateFrames = 0;
  }
}
