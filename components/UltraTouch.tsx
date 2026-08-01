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

/** Horizontal pinch-drag distance needed to switch panels */
const PANEL_SWITCH_THRESHOLD = 0.6;
/** Consecutive frames a gesture must hold before triggering action (~0.4s @ 30fps) */
const GESTURE_HOLD_FRAMES = 12;

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
  const [gestureProgress, setGestureProgress] = useState(0); // 0..1 hold progress

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
  const [showCameraPrompt, setShowCameraPrompt] = useState(true);

  // Gesture hold tracking
  const gestureHoldRef = useRef({ gesture: "none" as DiscreteGesture, frames: 0, acted: false });
  // Drag accumulation for panel switching
  const dragAccumRef = useRef(0);

  // ——— Voice State ———
  const [voiceListening, setVoiceListening] = useState(false);
  const voiceListeningRef = useRef(false);
  const recognitionRef = useRef<any>(null);
  const [voiceTranscript, setVoiceTranscript] = useState("");
  const silenceTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

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
      setActivityLog((prev) => [...prev.slice(-29), entry]);
    },
    [],
  );

  // Submit the final voice transcript to the backend
  const submitVoiceCommand = useCallback(
    async (transcript: string) => {
      if (!transcript.trim()) return;
      addActivity("🗣️", `Heard: "${transcript}"`, "info");

      try {
        const res = await fetch("/api/voice", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transcript }),
        });
        const data = await res.json();
        if (res.ok) {
          const results = data.executed ?? [];
          const summary = results
            .map((r: any) => `${r.status === "success" ? "✓" : "✗"} ${r.message ?? r.command}`)
            .join(", ");
          addActivity("🤖", summary || "Command executed", "success");
        } else {
          addActivity("❌", `AI Error: ${data.error}`, "error");
        }
      } catch (err: any) {
        addActivity("❌", `Failed to contact AI: ${err.message}`, "error");
      }
    },
    [addActivity],
  );

  // ——— Voice Recognition ———
  useEffect(() => {
    const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognition) return;

    const recognition = new SpeechRecognition();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = "en-US";

    recognition.onstart = () => {
      voiceListeningRef.current = true;
      setVoiceListening(true);
      setVoiceTranscript("");
      addActivity("🎙️", "Listening — speak your command…", "info");
    };

    recognition.onresult = (event: any) => {
      // Clear any existing silence timer
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }

      let finalText = "";
      let interimText = "";

      for (let i = 0; i < event.results.length; i++) {
        const result = event.results[i];
        if (result.isFinal) {
          finalText += result[0].transcript;
        } else {
          interimText += result[0].transcript;
        }
      }

      const currentText = (finalText + interimText).trim();
      setVoiceTranscript(currentText);

      // After 2 seconds of silence, auto-submit
      if (currentText) {
        silenceTimerRef.current = setTimeout(() => {
          silenceTimerRef.current = null;
          try { recognition.stop(); } catch { /* already stopped */ }
          submitVoiceCommand(currentText);
        }, 2000);
      }
    };

    recognition.onerror = (event: any) => {
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
      voiceListeningRef.current = false;
      setVoiceListening(false);
      setVoiceTranscript("");
      if (event.error !== "aborted" && event.error !== "no-speech") {
        addActivity("❌", `Voice error: ${event.error}`, "error");
      }
    };

    recognition.onend = () => {
      voiceListeningRef.current = false;
      setVoiceListening(false);
    };

    recognitionRef.current = recognition;

    return () => {
      if (silenceTimerRef.current) clearTimeout(silenceTimerRef.current);
      try { recognition.stop(); } catch { /* noop */ }
    };
  }, [addActivity, submitVoiceCommand]);

  const toggleVoice = useCallback(() => {
    if (!recognitionRef.current) {
      addActivity("❌", "Speech Recognition not supported in this browser", "error");
      return;
    }
    if (voiceListeningRef.current) {
      if (silenceTimerRef.current) {
        clearTimeout(silenceTimerRef.current);
        silenceTimerRef.current = null;
      }
      recognitionRef.current.stop();
      voiceListeningRef.current = false;
      setVoiceListening(false);
      setVoiceTranscript("");
    } else {
      try {
        voiceListeningRef.current = true;
        setVoiceTranscript("");
        recognitionRef.current.start();
      } catch (e) {
        voiceListeningRef.current = false;
        console.error("Failed to start voice", e);
      }
    }
  }, [addActivity]);



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
      const cpu = m.find((x) => x.id === "cpu");
      if (cpu) audioRef.current.setAmbientValue(cpu.value / 100);
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

  // ——— Mouse pointer → orb void carving ———
  useEffect(() => {
    const onMouseMove = (e: MouseEvent) => {
      const ndcX = (e.clientX / window.innerWidth) * 2 - 1;
      const ndcY = -((e.clientY / window.innerHeight) * 2 - 1);
      sceneRef.current?.updatePointer(ndcX, ndcY, true);
    };
    const onMouseOut = () => sceneRef.current?.updatePointer(0, 0, false);
    window.addEventListener("mousemove", onMouseMove, { passive: true });
    window.addEventListener("mouseout", onMouseOut, { passive: true });
    return () => {
      window.removeEventListener("mousemove", onMouseMove);
      window.removeEventListener("mouseout", onMouseOut);
    };
  }, []);

  // ——— Gesture → UI action wiring ———
  const handleLandmarks = useCallback(
    (landmarks: NormalizedLandmark[][], _handedness: string[]) => {
      if (landmarks.length === 0) {
        classifierRef.current.reset();
        setGesture("none");
        setGestureProgress(0);
        sceneRef.current?.updatePointer(0, 0, false);
        gestureHoldRef.current.acted = false;
        gestureHoldRef.current.frames = 0;
        return;
      }

      // Drive orb void from index fingertip (landmark 8) — mirrored
      const primaryHand = landmarks[0];
      if (primaryHand?.[8]) {
        const ndcX = (1 - primaryHand[8].x) * 2 - 1;
        const ndcY = -(primaryHand[8].y * 2 - 1);
        sceneRef.current?.updatePointer(ndcX, ndcY, true);
      }

      const g = classifierRef.current.update(primaryHand);
      setGesture(g);

      // Hold-frame accumulator
      const hold = gestureHoldRef.current;
      if (g === hold.gesture && g !== "none" && g !== "pinch") {
        hold.frames = Math.min(hold.frames + 1, GESTURE_HOLD_FRAMES);
      } else if (g !== hold.gesture) {
        hold.gesture = g;
        hold.frames = g !== "none" && g !== "pinch" ? 1 : 0;
        hold.acted = false;
      }

      // Expose progress for the hold-ring UI
      const progress = (g !== "none" && g !== "pinch")
        ? hold.frames / GESTURE_HOLD_FRAMES
        : 0;
      setGestureProgress(progress);

      if (hold.frames >= GESTURE_HOLD_FRAMES && !hold.acted) {
        hold.acted = true;
        sceneRef.current?.triggerBlowUp();
        switch (g) {
          case "open_palm": handleGestureSelect(); break;
          case "fist":      handleGestureCancel(); break;
          case "point":     handleGesturePoint();  break;
        }
      }
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [],
  );

  // Refs to avoid stale closure captures
  const activePanelRef  = useRef(activePanel);
  const expandedRef     = useRef(expanded);
  const focusedMetricRef = useRef(focusedMetric);
  const focusedDeviceRef = useRef(focusedDevice);
  const devicesRef       = useRef(devices);

  useEffect(() => { activePanelRef.current   = activePanel;   }, [activePanel]);
  useEffect(() => { expandedRef.current      = expanded;      }, [expanded]);
  useEffect(() => { focusedMetricRef.current = focusedMetric; }, [focusedMetric]);
  useEffect(() => { focusedDeviceRef.current = focusedDevice; }, [focusedDevice]);
  useEffect(() => { devicesRef.current       = devices;       }, [devices]);

  const handleGestureSelect = useCallback(() => {
    if (activePanelRef.current === 0) {
      setExpanded(true);
      audioRef.current.playSelect();
      addActivity("📊", "Expanded metric view", "info");
    } else if (activePanelRef.current === 1) {
      const device = devicesRef.current[focusedDeviceRef.current];
      if (device) toggleDevice(device.id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [addActivity]);

  const handleGestureCancel = useCallback(() => {
    if (expandedRef.current) {
      setExpanded(false);
      audioRef.current.playCancel();
      addActivity("↩️", "Collapsed view", "info");
    }
  }, [addActivity]);

  const handleGesturePoint = useCallback(() => {
    if (activePanelRef.current === 1) {
      const device = devicesRef.current[focusedDeviceRef.current];
      if (device) toggleDevice(device.id);
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleDevice = useCallback(
    (deviceId: string) => {
      const ds  = deviceStateRef.current;
      const audio = audioRef.current;
      const result = ds.toggle(deviceId);
      if (result) {
        const isOn = result.type === "toggle" || result.type === "lock"
          ? (result.state as boolean)
          : false;
        isOn ? audio.playToggleOn() : audio.playToggleOff();
        sceneRef.current?.pulsePanel(1, isOn ? "#4ade80" : "#f87171");
        setConfirmingDevice(deviceId);
        setTimeout(() => setConfirmingDevice(null), 600);
        addActivity(
          result.icon,
          `${result.name}: ${result.type === "lock" ? (isOn ? "Locked" : "Unlocked") : isOn ? "On" : "Off"}`,
          "success",
        );
      } else {
        audio.playError();
        addActivity("❌", "Failed to toggle device", "error");
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
        setActivePanel((p) => {
          const next = Math.min(p + 1, PANEL_COUNT - 1);
          if (next !== p) { audioRef.current.playNavigate(); addActivity("→", `Panel ${next + 1}`, "info"); }
          return next;
        });
      } else if (dragAccumRef.current < -PANEL_SWITCH_THRESHOLD) {
        dragAccumRef.current = 0;
        setActivePanel((p) => {
          const next = Math.max(p - 1, 0);
          if (next !== p) { audioRef.current.playNavigate(); addActivity("←", `Panel ${next + 1}`, "info"); }
          return next;
        });
      }
    },
    [addActivity],
  );

  // ——— Zoom → drill in/out ———
  const handleZoom = useCallback(
    (factor: number) => {
      if (factor < 0.92 && !expandedRef.current) {
        setExpanded(true);
        audioRef.current.playSelect();
        addActivity("🔍", "Zoomed into detail", "info");
      } else if (factor > 1.08 && expandedRef.current) {
        setExpanded(false);
        audioRef.current.playCancel();
        addActivity("↩️", "Zoomed out", "info");
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
    setGestureProgress(0);
    dragAccumRef.current = 0;
    addActivity("📷", "Camera off", "info");
  }, [addActivity]);

  const startGestures = useCallback(async () => {
    const video   = videoRef.current;
    const overlay = overlayRef.current;
    if (!video || !overlay || trackerRef.current) return;

    await audioRef.current.init();
    setCamera("starting");
    setError(null);
    setShowCameraPrompt(false);

    const tracker = new HandTracker(video, overlay, {
      onDrag:      handleDrag,
      onZoom:      handleZoom,
      onStatus:    setStatus,
      onLandmarks: handleLandmarks,
    });
    trackerRef.current = tracker;

    try {
      await tracker.start();
      setCamera("on");
      addActivity("📹", "Camera on — show your hands!", "success");
    } catch (err) {
      trackerRef.current = null;
      tracker.stop();
      setCamera("error");
      const msg = err instanceof DOMException && err.name === "NotAllowedError"
        ? "Camera access denied — check browser permissions"
        : `Tracking init failed: ${err instanceof Error ? err.message : String(err)}`;
      setError(msg);
      addActivity("❌", msg, "error");
      console.error("[UltraTouch] tracker start error:", err);
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
      if (e.target instanceof HTMLInputElement || e.target instanceof HTMLTextAreaElement) return;
      switch (e.key) {
        case "ArrowLeft":
          if (!showGuide) { e.preventDefault(); setActivePanel((p) => { const n = Math.max(p - 1, 0); if (n !== p) audioRef.current.playNavigate(); return n; }); }
          break;
        case "ArrowRight":
          if (!showGuide) { e.preventDefault(); setActivePanel((p) => { const n = Math.min(p + 1, PANEL_COUNT - 1); if (n !== p) audioRef.current.playNavigate(); return n; }); }
          break;
        case "Enter":
          if (!showGuide && !expanded) { e.preventDefault(); setExpanded(true); audioRef.current.playSelect(); }
          break;
        case "Escape":
          if (showGuide) setShowGuide(false);
          else if (expanded) { setExpanded(false); audioRef.current.playCancel(); }
          break;
        case "g": case "G": toggleCamera(); break;
        case "?": setShowGuide((p) => !p); break;
        case "m": case "M": toggleMute(); break;
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
      {/* 3D plasma orb background */}
      <div ref={sceneContainerRef} className="scene-root" />

      <StatusBar
        cameraOn={camera === "on"}
        cameraStarting={camera === "starting"}
        gesture={gesture}
        gestureProgress={gestureProgress}
        soundMuted={soundMuted}
        activePanel={activePanel}
        onToggleCamera={toggleCamera}
        onToggleMute={toggleMute}
        onShowGuide={() => setShowGuide(true)}
        voiceListening={voiceListening}
        voiceTranscript={voiceTranscript}
        onToggleVoice={toggleVoice}
      />

      {/* First-time camera prompt */}
      {showCameraPrompt && camera === "off" && (
        <div className="camera-prompt" role="complementary">
          <div className="camera-prompt-inner">
            <span className="camera-prompt-icon">✋</span>
            <p>Enable gesture control</p>
            <button
              className="camera-prompt-btn"
              onClick={toggleCamera}
              type="button"
            >
              Start Camera
            </button>
            <button
              className="camera-prompt-dismiss"
              onClick={() => setShowCameraPrompt(false)}
              aria-label="Dismiss"
              type="button"
            >
              Use keyboard only
            </button>
          </div>
        </div>
      )}

      {/* Three panels */}
      <main className="panel-arc" role="main">
        <div
          className={`panel-container ${expanded ? "expanded" : ""}`}
          style={{ transform: `translateX(${-activePanel * 100}%)` }}
        >
          <section className={`panel-slot ${activePanel === 0 ? "active" : ""}`} aria-hidden={activePanel !== 0}>
            <DataPanel
              metrics={metrics}
              focusedMetric={focusedMetric}
              expanded={expanded && activePanel === 0}
              onFocusMetric={(i) => { setFocusedMetric(i); audioRef.current.playHover(); }}
              onSelectMetric={(i) => {
                setFocusedMetric(i);
                setExpanded(true);
                audioRef.current.playSelect();
                addActivity("📊", `Expanded ${metrics[i]?.label ?? "metric"}`, "info");
              }}
            />
          </section>
          <section className={`panel-slot ${activePanel === 1 ? "active" : ""}`} aria-hidden={activePanel !== 1}>
            <DevicePanel
              devices={devices}
              focusedDevice={focusedDevice}
              onFocusDevice={(i) => { setFocusedDevice(i); audioRef.current.playHover(); }}
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
          <section className={`panel-slot ${activePanel === 2 ? "active" : ""}`} aria-hidden={activePanel !== 2}>
            <ActivityPanel
              entries={activityLog}
              soundMuted={soundMuted}
              onToggleMute={toggleMute}
            />
          </section>
        </div>
      </main>

      <CameraPreview
        videoRef={videoRef}
        overlayRef={overlayRef}
        cameraOn={cameraOn}
        status={status}
        gesture={gesture}
      />

      <GestureGuide visible={showGuide} onClose={() => setShowGuide(false)} />

      <div className="keyboard-hints" aria-hidden="true">
        <span><kbd>←</kbd><kbd>→</kbd> panels</span>
        <span><kbd>Enter</kbd> select</span>
        <span><kbd>Esc</kbd> back</span>
        <span><kbd>G</kbd> camera</span>
        <span><kbd>?</kbd> guide</span>
        <span><kbd>M</kbd> mute</span>
      </div>

      {error && <div className="error-toast" role="alert">{error}</div>}
    </>
  );
}
