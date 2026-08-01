# UltraTouch — Touchless Control Hub

A **touchless control hub** built with **Next.js**, **Three.js**, and **MediaPipe** hand tracking. Navigate live data, control smart devices, and receive audio feedback — all with hand gestures and zero touch input.

Designed for sterile environments (hospitals, kitchens, labs), users with limited mobility or dexterity, or anyone who needs hands-free multitasking.

## Features

- **Three connected panels**: Live Data Dashboard, Smart Device Controls, Activity Log
- **Dynamic ADB Integration**: Connect physical Android devices via ADB (USB or wireless) to dynamically populate controls (Play/Pause, Lock, Volume) straight from the hub.
- **Floating Neon UI**: A fully responsive floating navbar with an animated neon aura.
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

- **`app/api/android/route.ts`** — Next.js API route that interfaces locally with `adb` to scan for connected devices and dispatch `keyevent` commands (play, pause, lock, volume).
- **`lib/handTracker.ts`** — MediaPipe HandLandmarker with pinch detection + hysteresis. Forwards raw landmarks to the gesture classifier.
- **`lib/gestureClassifier.ts`** — Discrete gesture recognition (open palm, fist, point, pinch) with frame-based hold hysteresis.
- **`lib/audioEngine.ts`** — Web Audio API: distinct synthesized tones for hover/select/confirm/error/cancel/toggle, plus ambient data sonification.
- **`lib/sceneEngine.ts`** — Three.js ambient scene: floating glass panels, particles, bloom + chromatic aberration post-processing.
- **`lib/mockDataFeed.ts`** — Simulated live metrics with random walks.
- **`lib/mockDeviceState.ts`** — State manager that actively polls the Android API route to dynamically list connected physical devices and controls.
- **`components/UltraTouch.tsx`** — Main orchestrator wiring gestures → UI → audio → scene.
- **`components/StatusBar.tsx`** — Floating top bar with animated neon glow, panel tabs, and navigation links.
- **`app/help/page.tsx`** — Setup and help documentation for connecting devices and using gestures.

## Accessibility

- Every gesture action produces a **redundant audio signal** so users who can't see the screen still know what happened
- **Generous hysteresis** on all gesture detection (inherited from the pinch-detection code, extended to discrete gestures)
- **Full keyboard navigation** — Tab, arrow keys, Enter/Space, Escape
- **Screen reader support** — `aria-live` regions, proper `role` attributes, labeled controls
- **Gesture cheat sheet** — keyboard/screen-reader accessible for users without a webcam

## License

MIT
