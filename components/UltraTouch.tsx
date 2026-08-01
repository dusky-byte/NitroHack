"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createScene, type SceneApi } from "@/lib/sceneEngine";
import { HandTracker, type TrackerStatus } from "@/lib/handTracker";
import { GestureClassifier, type DiscreteGesture } from "@/lib/gestureClassifier";
import { AudioEngine } from "@/lib/audioEngine";
import { MockDataFeed, type Metric } from "@/lib/mockDataFeed";
import { MockDeviceState, type Device } from "@/lib/mockDeviceState";
import type { NormalizedLandmark } from "@mediapipe/tasks-vision";

import StatusBar from "@/components/StatusBar";
import DataPanel from "@/components/DataPanel";
import DevicePanel from "@/components/DevicePanel";
import ActivityPanel, { type ActivityEntry } from "@/components/ActivityPanel";
import GestureGuide from "@/components/GestureGuide";
import CameraPreview from "@/components/CameraPreview";

type CameraState = "off" | "starting" | "on" | "error";

const PANEL_COUNT = 3;

/** How much horizontal drag is needed to switch panels */
const PANEL_SWITCH_THRESHOLD = 0.8;
/** How many consecutive frames a gesture must hold for an action */
const GESTURE_HOLD_FRAMES = 15; // ~0.5s at 30fps

export default function UltraTouch() {
  // ——— Refs ———
  const sceneContainerRef = useRef<HTMLDivElement>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const overlayRef = useRef<HTMLCanvasElement>(null);
  const sceneRef = useRef<SceneApi | null>(null);
  const trackerRef = useRef<HandTracker | null>(null);
  const classifierRef = useRef(new GestureClassifier());
  const audioRef = useRef(new AudioEngine());
  const dataFeedRef = useRef(new MockDataFeed());
  const deviceStateRef = useRef(new MockDeviceState());

  // ——— State ———
  const [camera, setCamera] = useState<CameraState>("off");
  const [status, setStatus] = useState<TrackerStatus>({ hands: 0, mode: "idle" });
  const [gesture, setGesture] = useState<DiscreteGesture>("none");
  const [error, setError] = useState<string | null>(null);

  // Panels: 0=Data, 1=Devices, 2=Activity
  const [activePanel, setActivePanel] = useState(0);
  const [expanded, setExpanded] = useState(false);
  const [focusedMetric, setFocusedMetric] = useState(0);
  const [focusedDevice, setFocusedDevice] = useState(0);
  const [metrics, setMetrics] = useState<Metric[]>([]);
  const [devices, setDevices] = useState<Device[]>([]);
  const [confirmingDevice, setConfirmingDevice] = useState<string | null>(null);
  const [soundMuted, setSoundMuted] = useState(false);
  const [showGuide, setShowGuide] = useState(false);
  const [activityLog, setActivityLog] = useState<ActivityEntry[]>([]);

  // Gesture hold tracking
  const gestureHoldRef = useRef({ gesture: "none" as DiscreteGesture, frames: 0, acted: false });
  // Drag accumulation for panel switching
  const dragAccumRef = useRef(0);

  // ——— Activity log helper ———
  const addActivity = useCallback(
    (icon: string, description: string, type: ActivityEntry["type"] = "info") => {
      const entry: ActivityEntry = {
        id: `${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
        timestamp: Date.now(),
        icon,
        description,
        type,
      };
      setActivityLog((prev) => [...prev.slice(-19), entry]);
    },
    [],
  );

  // ——— Scene initialization ———
  useEffect(() => {
    const container = sceneContainerRef.current;
    if (!container) return;
    const scene = createScene(container);
    sceneRef.current = scene;
    return () => {
      trackerRef.current?.stop();
      trackerRef.current = null;
      scene.dispose();
      sceneRef.current = null;
    };
  }, []);

  // ——— Data feed ———
  useEffect(() => {
    const feed = dataFeedRef.current;
    const unsub = feed.subscribe((m) => {
      setMetrics(m);
      // Drive ambient sonification from CPU load
      const cpu = m.find((x) => x.id === "cpu");
      if (cpu) {
        audioRef.current.setAmbientValue(cpu.value / 100);
      }
    });
    feed.start();
    return () => {
      unsub();
      feed.stop();
    };
  }, []);

  // ——— Device state ———
  useEffect(() => {
    const ds = deviceStateRef.current;
    const unsub = ds.subscribe(setDevices);
    return () => unsub();
  }, []);

  // ——— Update scene focus ———
  useEffect(() => {
    sceneRef.current?.setFocusedPanel(activePanel);
  }, [activePanel]);

  // ——— Mouse & Hand Tip Pointer Tracking for Plasma Orb Void Carving ———
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      const ndcX = (e.clientX / window.innerWidth) * 2 - 1;
      const ndcY = -((e.clientY / window.innerHeight) * 2 - 1);
      sceneRef.current?.updatePointer(ndcX, ndcY, true);
    };
    window.addEventListener("mousemove", onMouseMove, { passive: true });
    return () => window.removeEventListener("mousemove", onMouseMove);
  }, []);

  // ——— Gesture → UI action wiring ———
  const handleLandmarks = useCallback(
    (landmarks: NormalizedLandmark[][], _handedness: string[]) => {
      if (landmarks.length === 0) {
        classifierRef.current.reset();
        setGesture("none");
        sceneRef.current?.updatePointer(0, 0, false);
        return;
      }

      // Update pointer void from index fingertip (landmark 8)
      const primaryHand = landmarks[0];
      if (primaryHand && primaryHand[8]) {
        // Mirrored X for user perspective
        const ndcX = (1 - primaryHand[8].x) * 2 - 1;
        const ndcY = -(primaryHand[8].y * 2 - 1);
        sceneRef.current?.updatePointer(ndcX, ndcY, true);
      }

      // Classify primary hand (first detected)
      const g = classifierRef.current.update(primaryHand);
      setGesture(g);

      // Hold tracking for discrete gestures
      const hold = gestureHoldRef.current;
      if (g === hold.gesture) {
        hold.frames++;
      } else {
        hold.gesture = g;
        hold.frames = 1;
        hold.acted = false;
      }

      // Trigger action when hold threshold reached (only once per hold)
      if (hold.frames >= GESTURE_HOLD_FRAMES && !hold.acted) {
        hold.acted = true;
        sceneRef.current?.triggerBlowUp();
        switch (g) {
          case "open_palm":
            handleGestureSelect();
            break;
          case "fist":
            handleGestureCancel();
            break;
          case "point":
            handleGesturePoint();
            break;
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Gesture action handlers need latest state — use refs
  const activePanelRef = useRef(activePanel);
  const expandedRef = useRef(expanded);
  const focusedMetricRef = useRef(focusedMetric);
  const focusedDeviceRef = useRef(focusedDevice);
  const devicesRef = useRef(devices);

  useEffect(() => { activePanelRef.current = activePanel; }, [activePanel]);
  useEffect(() => { expandedRef.current = expanded; }, [expanded]);
  useEffect(() => { focusedMetricRef.current = focusedMetric; }, [focusedMetric]);
  useEffect(() => { focusedDeviceRef.current = focusedDevice; }, [focusedDevice]);
  useEffect(() => { devicesRef.current = devices; }, [devices]);

  const handleGestureSelect = useCallback(() => {
    const audio = audioRef.current;
    if (activePanelRef.current === 0) {
      // Select drills into a metric
      setExpanded(true);
      audio.playSelect();
      addActivity("📊", `Drilled into metric`, "info");
    } else if (activePanelRef.current === 1) {
      // Select toggles focused device
      const flatDevices = devicesRef.current;
      const device = flatDevices[focusedDeviceRef.current];
      if (device) {
        toggleDevice(device.id);
      }
    }
    // Panel 2 (Activity): select does nothing special
  }, [addActivity]);

  const handleGestureCancel = useCallback(() => {
    const audio = audioRef.current;
    if (expandedRef.current) {
      setExpanded(false);
      audio.playCancel();
      addActivity("↩️", "Zoomed out", "info");
    }
  }, [addActivity]);

  const handleGesturePoint = useCallback(() => {
    // Point gesture: toggle the focused device on the device panel
    if (activePanelRef.current === 1) {
      const device = devicesRef.current[focusedDeviceRef.current];
      if (device) {
        toggleDevice(device.id);
      }
    }
  }, []);

  const toggleDevice = useCallback(
    (deviceId: string) => {
      const ds = deviceStateRef.current;
      const audio = audioRef.current;
      const result = ds.toggle(deviceId);
      if (result) {
        const isOn =
          result.type === "toggle" || result.type === "lock"
            ? (result.state as boolean)
            : false;
        if (isOn) {
          audio.playToggleOn();
          sceneRef.current?.pulsePanel(1, "#4ade80");
        } else {
          audio.playToggleOff();
          sceneRef.current?.pulsePanel(1, "#f87171");
        }
        setConfirmingDevice(deviceId);
        setTimeout(() => setConfirmingDevice(null), 600);
        addActivity(
          result.icon,
          `${result.name}: ${result.type === "lock" ? (isOn ? "Locked" : "Unlocked") : isOn ? "On" : "Off"}`,
          "success",
        );
      } else {
        audio.playError();
        addActivity("❌", `Failed to toggle device`, "error");
      }
    },
    [addActivity],
  );

  // ——— Drag → panel switching ———
  const handleDrag = useCallback(
    (dx: number, _dy: number) => {
      dragAccumRef.current += dx;
      if (dragAccumRef.current > PANEL_SWITCH_THRESHOLD) {
        dragAccumRef.current = 0;
        setActivePanel((prev) => {
          const next = Math.min(prev + 1, PANEL_COUNT - 1);
          if (next !== prev) {
            audioRef.current.playNavigate();
            addActivity("👉", `Switched to panel ${next + 1}`, "info");
          }
          return next;
        });
      } else if (dragAccumRef.current < -PANEL_SWITCH_THRESHOLD) {
        dragAccumRef.current = 0;
        setActivePanel((prev) => {
          const next = Math.max(prev - 1, 0);
          if (next !== prev) {
            audioRef.current.playNavigate();
            addActivity("👈", `Switched to panel ${next + 1}`, "info");
          }
          return next;
        });
      }
    },
    [addActivity],
  );

  // ——— Zoom → drill in/out ———
  const handleZoom = useCallback(
    (factor: number) => {
      if (factor < 0.92) {
        // Zoom in → expand
        if (!expandedRef.current) {
          setExpanded(true);
          audioRef.current.playSelect();
          addActivity("🔍", "Zoomed into detail view", "info");
        }
      } else if (factor > 1.08) {
        // Zoom out → collapse
        if (expandedRef.current) {
          setExpanded(false);
          audioRef.current.playCancel();
          addActivity("↩️", "Zoomed out", "info");
        }
      }
    },
    [addActivity],
  );

  // ——— Camera / tracker controls ———
  const stopGestures = useCallback(() => {
    trackerRef.current?.stop();
    trackerRef.current = null;
    classifierRef.current.reset();
    setCamera("off");
    setStatus({ hands: 0, mode: "idle" });
    setGesture("none");
    dragAccumRef.current = 0;
    addActivity("📷", "Camera disabled", "info");
  }, [addActivity]);

  const startGestures = useCallback(async () => {
    const video = videoRef.current;
    const overlay = overlayRef.current;
    if (!video || !overlay || trackerRef.current) return;

    // Init audio on first user gesture (browser policy)
    await audioRef.current.init();

    setCamera("starting");
    setError(null);

    const tracker = new HandTracker(video, overlay, {
      onDrag: handleDrag,
      onZoom: handleZoom,
      onStatus: setStatus,
      onLandmarks: handleLandmarks,
    });
    trackerRef.current = tracker;

    try {
      await tracker.start();
      setCamera("on");
      addActivity("📹", "Camera enabled — show your hands!", "success");
    } catch (err) {
      trackerRef.current = null;
      tracker.stop();
      setCamera("error");
      setError(
        err instanceof DOMException && err.name === "NotAllowedError"
          ? "Camera access denied"
          : "Tracking initialization failed",
      );
      addActivity("❌", "Camera failed to start", "error");
    }
  }, [handleDrag, handleZoom, handleLandmarks, addActivity]);

  const toggleCamera = useCallback(() => {
    if (trackerRef.current) stopGestures();
    else void startGestures();
  }, [startGestures, stopGestures]);

  const toggleMute = useCallback(() => {
    setSoundMuted((prev) => {
      const next = !prev;
      audioRef.current.setMuted(next);
      return next;
    });
  }, []);

  // ——— Keyboard navigation ———
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      // Don't intercept if user is in an input
      if (
        e.target instanceof HTMLInputElement ||
        e.target instanceof HTMLTextAreaElement
      )
        return;

      switch (e.key) {
        case "ArrowLeft":
          if (!showGuide) {
            e.preventDefault();
            setActivePanel((p) => {
              const next = Math.max(p - 1, 0);
              if (next !== p) audioRef.current.playNavigate();
              return next;
            });
          }
          break;
        case "ArrowRight":
          if (!showGuide) {
            e.preventDefault();
            setActivePanel((p) => {
              const next = Math.min(p + 1, PANEL_COUNT - 1);
              if (next !== p) audioRef.current.playNavigate();
              return next;
            });
          }
          break;
        case "Enter":
          if (!showGuide) {
            e.preventDefault();
            if (!expanded) {
              setExpanded(true);
              audioRef.current.playSelect();
            }
          }
          break;
        case "Escape":
          if (showGuide) {
            setShowGuide(false);
          } else if (expanded) {
            setExpanded(false);
            audioRef.current.playCancel();
          }
          break;
        case "g":
        case "G":
          toggleCamera();
          break;
        case "?":
          setShowGuide((p) => !p);
          break;
        case "m":
        case "M":
          toggleMute();
          break;
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [toggleCamera, toggleMute, expanded, showGuide]);

  // ——— Cleanup ———
  useEffect(() => {
    return () => {
      audioRef.current.dispose();
      dataFeedRef.current.stop();
    };
  }, []);

  const cameraOn = camera === "on";

  return (
    <>
      {/* 3D ambient background */}
      <div ref={sceneContainerRef} className="scene-root" />

      {/* Status bar */}
      <StatusBar
        cameraOn={cameraOn}
        cameraStarting={camera === "starting"}
        gesture={gesture}
        soundMuted={soundMuted}
        activePanel={activePanel}
        onToggleCamera={toggleCamera}
        onToggleMute={toggleMute}
        onShowGuide={() => setShowGuide(true)}
      />

      {/* Main content: three panels */}
      <main className="panel-arc" role="main">
        <div
          className={`panel-container ${expanded ? "expanded" : ""}`}
          style={{ transform: `translateX(${-activePanel * 100}%)` }}
        >
          <section
            className={`panel-slot ${activePanel === 0 ? "active" : ""}`}
            aria-hidden={activePanel !== 0}
          >
            <DataPanel
              metrics={metrics}
              focusedMetric={focusedMetric}
              expanded={expanded && activePanel === 0}
              onFocusMetric={(i) => {
                setFocusedMetric(i);
                audioRef.current.playHover();
              }}
              onSelectMetric={(i) => {
                setFocusedMetric(i);
                setExpanded(true);
                audioRef.current.playSelect();
                addActivity("📊", `Expanded ${metrics[i]?.label ?? "metric"}`, "info");
              }}
            />
          </section>
          <section
            className={`panel-slot ${activePanel === 1 ? "active" : ""}`}
            aria-hidden={activePanel !== 1}
          >
            <DevicePanel
              devices={devices}
              focusedDevice={focusedDevice}
              onFocusDevice={(i) => {
                setFocusedDevice(i);
                audioRef.current.playHover();
              }}
              onToggleDevice={toggleDevice}
              onSetDeviceValue={(id, v) => {
                deviceStateRef.current.setValue(id, v);
                audioRef.current.playConfirm();
                const d = deviceStateRef.current.getDevice(id);
                if (d) addActivity(d.icon, `${d.name}: ${d.state}${d.rangeUnit ?? ""}`, "success");
              }}
              confirmingDevice={confirmingDevice}
            />
          </section>
          <section
            className={`panel-slot ${activePanel === 2 ? "active" : ""}`}
            aria-hidden={activePanel !== 2}
          >
            <ActivityPanel
              entries={activityLog}
              soundMuted={soundMuted}
              onToggleMute={toggleMute}
            />
          </section>
        </div>
      </main>

      {/* Camera preview */}
      <CameraPreview
        videoRef={videoRef}
        overlayRef={overlayRef}
        cameraOn={cameraOn}
        status={status}
        gesture={gesture}
      />

      {/* Gesture guide */}
      <GestureGuide visible={showGuide} onClose={() => setShowGuide(false)} />

      {/* Keyboard hints */}
      <div className="keyboard-hints" aria-hidden="true">
        <span><kbd>←</kbd><kbd>→</kbd> panels</span>
        <span><kbd>Enter</kbd> select</span>
        <span><kbd>Esc</kbd> back</span>
        <span><kbd>G</kbd> camera</span>
        <span><kbd>?</kbd> guide</span>
        <span><kbd>M</kbd> mute</span>
      </div>

      {/* Error toast */}
      {error && (
        <div className="error-toast" role="alert">
          {error}
        </div>
      )}
    </>
  );
}
