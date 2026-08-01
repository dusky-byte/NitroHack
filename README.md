# UltraTouch — Touchless Control Hub

A **touchless control hub** built with **Next.js**, **Three.js**, and **MediaPipe** hand tracking. Navigate live data, control smart devices, and receive audio feedback — all with hand gestures and zero touch input.

Designed for sterile environments (hospitals, kitchens, labs), users with limited mobility or dexterity, or anyone who needs hands-free multitasking.

## Features

- **Three connected panels**: Live Data Dashboard, Smart Device Controls, Activity Log
- **5-gesture vocabulary**: Pinch+drag, two-hand zoom, open palm select, fist cancel, point toggle
- **Audio-reactive feedback**: Every action produces a distinct sound — accessibility backbone, not decoration
- **Full keyboard fallback**: Works without a webcam for accessibility
- **Ambient 3D scene**: Floating frosted-glass panels with bloom and chromatic aberration post-processing

## Getting started

```bash
npm install
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

## Controls

### Hand gestures (webcam)

Press `G` or click the camera button to enable hand tracking, then:

| Gesture | Action |
| --- | --- |
| Pinch (thumb + index) one hand + drag | Scrub between panels |
| Pinch with **both** hands, spread/close | Zoom into / out of detail view |
| Open palm (hold) | Select the focused item |
| Fist | Cancel / go back |
| Point (hold) | Toggle a device directly |

### Keyboard

| Key | Action |
| --- | --- |
| `←` `→` | Switch panels |
| `↑` `↓` | Navigate items within a panel |
| `Enter` / `Space` | Select / toggle |
| `Escape` | Cancel / zoom out |
| `G` | Toggle hand gestures |
| `M` | Toggle sound |
| `?` | Show gesture guide |

## Architecture

- **`lib/handTracker.ts`** — MediaPipe HandLandmarker with pinch detection + hysteresis. Forwards raw landmarks to the gesture classifier.
- **`lib/gestureClassifier.ts`** — Discrete gesture recognition (open palm, fist, point, pinch) with frame-based hold hysteresis.
- **`lib/audioEngine.ts`** — Web Audio API: distinct synthesized tones for hover/select/confirm/error/cancel/toggle, plus ambient data sonification.
- **`lib/sceneEngine.ts`** — Three.js ambient scene: floating glass panels, particles, bloom + chromatic aberration post-processing.
- **`lib/mockDataFeed.ts`** — Simulated live metrics with random walks. Swap for a real API.
- **`lib/mockDeviceState.ts`** — Simulated IoT devices. Swap for a real API.
- **`components/UltraTouch.tsx`** — Main orchestrator wiring gestures → UI → audio → scene.
- **`components/DataPanel.tsx`** — Live data dashboard with sparklines and expanded view.
- **`components/DevicePanel.tsx`** — IoT device toggles with visual+audio confirmation.
- **`components/ActivityPanel.tsx`** — Activity log + audio visualizer.
- **`components/GestureGuide.tsx`** — Accessible gesture cheat sheet dialog.
- **`components/CameraPreview.tsx`** — Webcam preview with gesture overlay.
- **`components/StatusBar.tsx`** — Top bar with branding, panel tabs, and controls.

## Accessibility

- Every gesture action produces a **redundant audio signal** so users who can't see the screen still know what happened
- **Generous hysteresis** on all gesture detection (inherited from the pinch-detection code, extended to discrete gestures)
- **Full keyboard navigation** — Tab, arrow keys, Enter/Space, Escape
- **Screen reader support** — `aria-live` regions, proper `role` attributes, labeled controls
- **Gesture cheat sheet** — keyboard/screen-reader accessible for users without a webcam

## License

MIT
