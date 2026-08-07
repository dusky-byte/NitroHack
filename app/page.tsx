"use client";

import { useEffect, useRef, useState } from "react";
import { MockDeviceState, type Device } from "@/lib/mockDeviceState";
import WifiConnectPanel from "@/components/WifiConnectPanel";

const icon: Record<string, string> = {
  laptop: '<path d="M20 16V7a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v9"/><path d="M2 16h20l-1.6 3.2a1 1 0 0 1-.9.8H4.5a1 1 0 0 1-.9-.8L2 16Z"/>',
  phone: '<rect x="6" y="2" width="12" height="20" rx="2"/><path d="M11 18h2"/>',
  speaker: '<rect x="4" y="2" width="16" height="20" rx="2"/><circle cx="12" cy="14" r="4"/><path d="M12 6h.01"/>',
  radio: '<path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9"/><path d="M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"/><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5"/><path d="M19.1 4.9C23 8.8 23 15.1 19.1 19"/>',
  smartphone: '<rect x="5" y="2" width="14" height="20" rx="2" ry="2"/><line x1="12" y1="18" x2="12.01" y2="18"/>',
  warning: '<path d="M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z"/><line x1="12" y1="9" x2="12" y2="13"/><line x1="12" y1="17" x2="12.01" y2="17"/>'
};

const renderMarkdown = (text: string) => {
  if (!text) return null;
  const parts = text.split(/(!\[.*?\]\(.*?\))/g);
  return parts.map((part, i) => {
    const match = part.match(/!\[(.*?)\]\((.*?)\)/);
    if (match) {
      return (
        <img 
          key={i} 
          src={match[2]} 
          alt={match[1]} 
          style={{ maxWidth: '100%', borderRadius: '12px', marginTop: '12px', border: '1px solid rgba(255,255,255,0.1)', objectFit: 'contain' }} 
        />
      );
    }
    const boldParts = part.split(/(\*\*.*?\*\*)/g);
    return (
      <span key={i}>
        {boldParts.map((bp, j) => {
          const boldMatch = bp.match(/\*\*(.*?)\*\*/);
          if (boldMatch) return <strong key={j} style={{ color: 'white', fontWeight: 600 }}>{boldMatch[1]}</strong>;
          return <span key={j}>{bp}</span>;
        })}
      </span>
    );
  });
};

const colorFor: Record<string, string> = { voice: 'var(--red)', vision: 'var(--blue)', device: 'var(--green)', system: 'var(--yellow)' };

export default function Home() {
  const deviceStateRef = useRef<MockDeviceState | null>(null);

  const [devices, setDevices] = useState<Device[]>([]);
  const [activities, setActivities] = useState<any[]>([]);

  const [isUnlocked, setIsUnlocked] = useState(false);
  const [unlockPassword, setUnlockPassword] = useState('');
  const [settings, setSettings] = useState({ volume: 1.0, model: "llama-3.3-70b-versatile", apiKey: "", devicePin: "", lightweightMode: false, voicePassphrase: "" });
  const [modelDropdownOpen, setModelDropdownOpen] = useState(false);
  const [chatHistory, setChatHistory] = useState<{ role: string, content: string }[]>([]);
  const [deviceAliases, setDeviceAliases] = useState<Record<string, string>>({});
  
  // Ultron Response UI states
  const [isUltronThinking, setIsUltronThinking] = useState(false);
  const [ultronSpeech, setUltronSpeech] = useState<string | null>(null);
  const [typedUltronSpeech, setTypedUltronSpeech] = useState("");
  
  const [webSearchResult, setWebSearchResult] = useState<string | null>(null);
  const [typedWebSearchResult, setTypedWebSearchResult] = useState<string>("");
  const [webSearchLoading, setWebSearchLoading] = useState(false);
  const [webSearchCopied, setWebSearchCopied] = useState(false);

  // Refs to always get latest values inside the stale-closure of the main useEffect
  const devicesRef = useRef<Device[]>([]);
  const deviceAliasesRef = useRef<Record<string, string>>({});
  const chatHistoryRef = useRef<{ role: string, content: string }[]>([]);

  // Raw Audio Capture State
  const audioDataRef = useRef<Float32Array[]>([]);
  const audioLengthRef = useRef<number>(0);
  const sampleRateRef = useRef<number>(44100);

  const encodeWAV = (samples: Float32Array, sampleRate: number) => {
    const buffer = new ArrayBuffer(44 + samples.length * 2);
    const view = new DataView(buffer);
    const writeString = (v: DataView, offset: number, string: string) => {
      for (let i = 0; i < string.length; i++) v.setUint8(offset + i, string.charCodeAt(i));
    };
    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + samples.length * 2, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, 1, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, sampleRate * 2, true);
    view.setUint16(32, 2, true);
    view.setUint16(34, 16, true);
    writeString(view, 36, 'data');
    view.setUint32(40, samples.length * 2, true);
    let offset = 44;
    for (let i = 0; i < samples.length; i++, offset += 2) {
      let s = Math.max(-1, Math.min(1, samples[i]));
      view.setInt16(offset, s < 0 ? s * 0x8000 : s * 0x7FFF, true);
    }
    return new Blob([view], { type: 'audio/wav' });
  };

  useEffect(() => {
    if (!webSearchResult) {
      setTypedWebSearchResult("");
      return;
    }
    let i = 0;
    setTypedWebSearchResult("");
    const interval = setInterval(() => {
      setTypedWebSearchResult(webSearchResult.slice(0, i));
      i++;
      if (i > webSearchResult.length) {
        clearInterval(interval);
      }
    }, 10);
    return () => clearInterval(interval);
  }, [webSearchResult]);

  // Letter-by-letter typing effect for Ultron Speech
  useEffect(() => {
    if (!ultronSpeech) {
      setTypedUltronSpeech("");
      return;
    }
    let i = 0;
    setTypedUltronSpeech("");
    const interval = setInterval(() => {
      setTypedUltronSpeech(ultronSpeech.substring(0, i + 1));
      i++;
      if (i >= ultronSpeech.length) {
        clearInterval(interval);
      }
    }, 30);
    return () => clearInterval(interval);
  }, [ultronSpeech]);

  // Keep refs in sync with state
  useEffect(() => { devicesRef.current = devices; }, [devices]);
  useEffect(() => { deviceAliasesRef.current = deviceAliases; }, [deviceAliases]);
  useEffect(() => {
    try {
      const saved = localStorage.getItem('ultron_device_aliases');
      if (saved) setDeviceAliases(JSON.parse(saved));

      const savedChat = localStorage.getItem('ultron_chat_history');
      const savedTime = localStorage.getItem('ultron_chat_time');
      if (savedChat && savedTime) {
        const timeDiff = Date.now() - parseInt(savedTime);
        // 12 hours expiration
        if (timeDiff < 12 * 60 * 60 * 1000) {
          setChatHistory(JSON.parse(savedChat));
        } else {
          localStorage.removeItem('ultron_chat_history');
          localStorage.removeItem('ultron_chat_time');
        }
      }
    } catch { }
  }, []);

  useEffect(() => {
    chatHistoryRef.current = chatHistory;
    if (chatHistory.length > 0) {
      localStorage.setItem('ultron_chat_history', JSON.stringify(chatHistory));
      localStorage.setItem('ultron_chat_time', Date.now().toString());
    }
  }, [chatHistory]);

  const renameDevice = (deviceId: string) => {
    const current = deviceAliases[deviceId] || '';
    const newAlias = prompt(`Set alias for device ${deviceId}:`, current);
    if (newAlias === null) return; // cancelled
    const updated = { ...deviceAliases, [deviceId]: newAlias.trim() };
    setDeviceAliases(updated);
    localStorage.setItem('ultron_device_aliases', JSON.stringify(updated));
  };

  useEffect(() => {
    const vol = localStorage.getItem('ultron_volume');
    const mod = localStorage.getItem('ultron_model');
    const key = localStorage.getItem('ultron_apikey');
    const pin = localStorage.getItem('ultron_device_pin');
    const lw = localStorage.getItem('ultron_lightweight') === 'true';
    const vp = localStorage.getItem('ultron_voice_passphrase');
    setSettings({
      volume: vol ? parseFloat(vol) : 1.0,
      model: mod || "llama-3.3-70b-versatile",
      apiKey: key || "",
      devicePin: pin || "",
      lightweightMode: lw,
      voicePassphrase: vp || ""
    });
  }, []);

  const handleUnlock = (e: React.FormEvent) => {
    e.preventDefault();
    if (unlockPassword === 'ultron') {
      setIsUnlocked(true);
    } else {
      alert("Incorrect Master Password");
    }
  };

  const handleSaveSettings = (e: React.FormEvent) => {
    e.preventDefault();
    localStorage.setItem('ultron_volume', settings.volume.toString());
    localStorage.setItem('ultron_model', settings.model);
    localStorage.setItem('ultron_apikey', settings.apiKey);
    localStorage.setItem('ultron_device_pin', settings.devicePin);
    localStorage.setItem('ultron_lightweight', settings.lightweightMode ? 'true' : 'false');
    localStorage.setItem('ultron_voice_passphrase', settings.voicePassphrase);

    // Also show toast via our custom event or alert
    alert("Settings Saved successfully! Volume is now " + (settings.volume * 100) + "%.");
  };

  useEffect(() => {
    deviceStateRef.current = new MockDeviceState();
    const unsub = deviceStateRef.current.subscribe((devs) => {
      // Filter out INITIAL_DEVICES mock stuff, only keep real ADB devices
      const connected = devs.filter(d => d.id.startsWith("adb-device-"));
      setDevices(connected);
    });
    return unsub;
  }, []);

  const unlockedDevices = useRef(new Set<string>());

  useEffect(() => {
    const pin = localStorage.getItem('ultron_device_pin');
    if (!pin || devices.length === 0) return;

    devices.forEach(d => {
      if (d.category !== 'pc' && !unlockedDevices.current.has(d.id) && d.state) {
        unlockedDevices.current.add(d.id);
        const deviceId = d.id.replace('adb-device-', '');
        fetch("/api/android", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ type: "unlock", deviceId: deviceId, code: pin })
        });
      }
    });
  }, [devices]);

  useEffect(() => {
    const fetchLog = () => {
      fetch("/api/activities")
        .then(r => r.json())
        .then(d => {
          if (d.activities) {
            setActivities(d.activities.map((a: any) => ({
              ...a,
              time: new Date(a.timestamp).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })
            })));
          }
        }).catch(() => { });
    };
    fetchLog();
    const interval = setInterval(fetchLog, 3000);
    return () => clearInterval(interval);
  }, []);

  const addActivity = (tag: string, title: string) => {
    setActivities(prev => [{ title, time: 'Just now', tag }, ...prev.slice(0, 9)]);
  };

  useEffect(() => {
    const ac = new AbortController();
    const signal = ac.signal;

    // --- VANILLA JS PORTION ---
    const tabBtns = document.querySelectorAll('.tab-btn');
    const panels = document.querySelectorAll('.panel');
    tabBtns.forEach(btn => {
      btn.addEventListener('click', () => {
        tabBtns.forEach(b => b.classList.remove('active'));
        panels.forEach(p => p.classList.remove('active'));
        btn.classList.add('active');
        const targetTab = (btn as HTMLElement).dataset.tab;
        document.getElementById('panel-' + targetTab)?.classList.add('active');
      }, { signal });
    });

    const canvas = document.getElementById('orbCanvas') as HTMLCanvasElement;
    if (!canvas) return;
    const isLightweight = localStorage.getItem('ultron_lightweight') === 'true';
    if (isLightweight) {
      canvas.style.display = 'none';
      const halo = document.querySelector('.orb-halo') as HTMLElement;
      if (halo) {
        halo.style.background = 'radial-gradient(circle at 30% 30%, #a4c8ff, #4c8dff 30%, #1e4b99 70%, #050a14)';
        halo.style.opacity = '1';
        halo.style.boxShadow = '0 0 40px rgba(76, 141, 255, 0.3), inset -20px -20px 40px rgba(0,0,0,0.5)';
        halo.style.border = '1px solid rgba(255,255,255,0.1)';
      }
    } else {
      canvas.style.display = 'block';
      const halo = document.querySelector('.orb-halo') as HTMLElement;
      if (halo) {
        halo.style.background = '';
        halo.style.opacity = '';
        halo.style.boxShadow = '';
        halo.style.border = '';
      }
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    const stage = document.getElementById('orbStage');
    if (!stage) return;
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches;

    let DPR = Math.min(window.devicePixelRatio || 1, 2);
    let W: number, H: number, R: number;

    function sizeCanvas() {
      if (!stage || !canvas || !ctx) return;
      const size = Math.min(stage.clientWidth, stage.clientHeight, 480) * 0.9;
      W = size; H = size;
      canvas.width = W * DPR; canvas.height = H * DPR;
      canvas.style.width = W + 'px'; canvas.style.height = H + 'px';
      ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
      R = size * 0.36;
    }
    sizeCanvas();
    window.addEventListener('resize', sizeCanvas, { signal });

    const N = 220;
    function fibonacciSphere(samples: number) {
      const pts = [];
      const phi = Math.PI * (3 - Math.sqrt(5));
      for (let i = 0; i < samples; i++) {
        const y = 1 - (i / (samples - 1)) * 2;
        const r = Math.sqrt(1 - y * y);
        const theta = phi * i;
        pts.push({ x: Math.cos(theta) * r, y, z: Math.sin(theta) * r, seed: Math.random() * 1000 });
      }
      return pts;
    }
    const points = fibonacciSphere(N);

    const coreColors = ['#ff5a4e', '#ffc53d', '#3ddc97', '#4c8dff'];
    const coreSet = new Map();
    for (let i = 0; i < 8; i++) {
      const idx = Math.floor((i / 8) * N + (N / 16));
      coreSet.set(idx % N, coreColors[i % coreColors.length]);
    }

    function buildEdges(pts: any[], k: number) {
      const edgeSet = new Set();
      const edges = [];
      for (let i = 0; i < pts.length; i++) {
        const dists = [];
        for (let j = 0; j < pts.length; j++) {
          if (i === j) continue;
          const dx = pts[i].x - pts[j].x, dy = pts[i].y - pts[j].y, dz = pts[i].z - pts[j].z;
          dists.push([dx * dx + dy * dy + dz * dz, j]);
        }
        dists.sort((a, b) => a[0] - b[0]);
        for (let m = 0; m < k; m++) {
          const j = dists[m][1];
          const key = i < j ? i + '_' + j : j + '_' + i;
          if (!edgeSet.has(key)) { edgeSet.add(key); edges.push([i, j]); }
        }
      }
      return edges;
    }
    const edges = buildEdges(points, 3);

    const NS = 46;
    function shellSphere(samples: number, radiusMul: number) {
      const pts = [];
      const phi = Math.PI * (3 - Math.sqrt(5));
      for (let i = 0; i < samples; i++) {
        const y = 1 - (i / (samples - 1)) * 2;
        const r = Math.sqrt(1 - y * y);
        const theta = phi * i;
        pts.push({ x: Math.cos(theta) * r * radiusMul, y: y * radiusMul, z: Math.sin(theta) * r * radiusMul });
      }
      return pts;
    }
    const shellPoints = shellSphere(NS, 1.42);

    function hexToRgb(hex: string) {
      const v = hex.replace('#', '');
      return [parseInt(v.slice(0, 2), 16), parseInt(v.slice(2, 4), 16), parseInt(v.slice(4, 6), 16)];
    }
    const coreRgb = new Map();
    coreSet.forEach((hex, idx) => coreRgb.set(idx, hexToRgb(hex)));
    const brandColorsRgb = coreColors.map(hexToRgb);

    let rotY = 0.4, rotX = 0.3;
    let shellRotY = 0.9, shellRotX = 0.5;
    const baseSpeed = reducedMotion ? 0.0003 : 0.0016;
    let velY = 0, velX = 0;
    let isDragging = false;
    let lastPX = 0, lastPY = 0;

    let pointerX: number | null = null, pointerY: number | null = null, pointerInside = false;

    canvas.addEventListener('pointerdown', (e) => {
      isDragging = true;
      canvas.setPointerCapture(e.pointerId);
      lastPX = e.clientX; lastPY = e.clientY;
    }, { signal });
    canvas.addEventListener('pointermove', (e) => {
      const r = canvas.getBoundingClientRect();
      pointerX = e.clientX - r.left; pointerY = e.clientY - r.top;
      pointerInside = true;
      if (isDragging) {
        const dx = e.clientX - lastPX, dy = e.clientY - lastPY;
        rotY += dx * 0.006;
        rotX = Math.max(-1.3, Math.min(1.3, rotX + dy * 0.006));
        velY = dx * 0.006; velX = dy * 0.006;
        lastPX = e.clientX; lastPY = e.clientY;
      }
    }, { signal });
    window.addEventListener('pointerup', () => { isDragging = false; }, { signal });
    canvas.addEventListener('pointerleave', () => { pointerInside = false; }, { signal });
    canvas.addEventListener('pointercancel', () => { isDragging = false; }, { signal });

    let clickPulse = 0;
    canvas.addEventListener('click', () => { clickPulse = 1; }, { signal });

    let micActive = false;
    let audioCtx: any, analyser: any, dataArray: any, micSource: any, micStream: any;
    let amp = 0, ampTarget = 0;

    // Web Speech API
    let recognition: any = null;
    let silenceTimer: any = null;
    if (typeof window !== "undefined") {
      const SpeechRecognition = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
      if (SpeechRecognition) {
        recognition = new SpeechRecognition();
        recognition.continuous = true;
        recognition.interimResults = true;
      }
    }

    function updateBodyGlow(mActive: boolean, cActive: boolean) {
      document.body.classList.remove('is-mic-active', 'is-cam-active', 'is-both-active');
      if (mActive && cActive) document.body.classList.add('is-both-active');
      else if (mActive) document.body.classList.add('is-mic-active');
      else if (cActive) document.body.classList.add('is-cam-active');
    }

    // Removed fullscreen trigger to avoid Permission denied error in dev

    function speak(text: string) {
      if (!window.speechSynthesis) return;
      window.speechSynthesis.cancel();
      const ut = new SpeechSynthesisUtterance(text);
      const voices = window.speechSynthesis.getVoices();
      const preferred = voices.find(v => v.name.includes("Mark") || v.name.includes("UK English Male") || v.name.includes("Google UK English Male") || v.name.includes("Daniel") || v.name.includes("David"));
      if (preferred) ut.voice = preferred;

      const savedVol = localStorage.getItem('ultron_volume');
      ut.volume = Math.min(1.0, savedVol ? parseFloat(savedVol) : 1.0);

      ut.pitch = 0.55; // Deep and robotic
      ut.rate = 0.95; // Slightly slower, deliberate pacing

      // Trigger UI
      setUltronSpeech(text);
      
      ut.onend = () => {
        setTimeout(() => {
          setUltronSpeech(null);
        }, 5000);
      };

      window.speechSynthesis.speak(ut);
    }

    const greetings = [
      "Ultron systems online. Awaiting directive.",
      "All systems nominal. How may I assist you, sir?",
      "Greetings. I am ready for your command.",
      "System initialized. Standing by.",
      "Ultron activated. What is our objective today?"
    ];
    let voicesLoaded = false;
    function initVoices() {
      if (voicesLoaded) return;
      const voices = window.speechSynthesis.getVoices();
      if (voices.length > 0) {
        voicesLoaded = true;
        const msg = greetings[Math.floor(Math.random() * greetings.length)];
        speak(msg);
      }
    }
    if (window.speechSynthesis) {
      if (window.speechSynthesis.onvoiceschanged !== undefined) {
        window.speechSynthesis.onvoiceschanged = initVoices;
      }
      setTimeout(initVoices, 500);
    }

    let t0 = performance.now();
    let animFrame: number;

    function draw(now: number) {
      const dt = Math.min(40, now - t0); t0 = now;
      animFrame = requestAnimationFrame(draw);

      if (!isDragging) {
        rotY += baseSpeed * (dt / 16.67) + velY;
        rotX += velX;
        velY *= 0.92; velX *= 0.92;
      }
      shellRotY += baseSpeed * 0.45 * (dt / 16.67) + velY * 0.3;
      shellRotX += velX * 0.3;

      amp += (ampTarget - amp) * 0.18;
      clickPulse *= 0.91;

      if (!ctx) return;
      ctx.clearRect(0, 0, W, H);
      const cx = W / 2, cy = H / 2;
      const cosY = Math.cos(rotY), sinY = Math.sin(rotY);
      const cosX = Math.cos(rotX), sinX = Math.sin(rotX);

      const breathing = reducedMotion ? 1 : 1 + Math.sin(now / 1500) * 0.012;
      const pulse = breathing + amp * 0.2 + clickPulse * 0.22;

      const scy = Math.cos(shellRotY), ssy = Math.sin(shellRotY);
      const scx = Math.cos(shellRotX), ssx = Math.sin(shellRotX);
      
      if (!isLightweight) {
        ctx.globalCompositeOperation = 'lighter';
        for (let i = 0; i < shellPoints.length; i++) {
          const p = shellPoints[i];
          let x = p.x * scy - p.z * ssy;
          let z = p.x * ssy + p.z * scy;
          let y2 = p.y * scx - z * ssx;
          let z2 = p.y * ssx + z * scx;
          const scale = 1 / (1.9 - z2 * 0.55);
          const sx = cx + x * R * scale;
          const sy = cy + y2 * R * scale;
          const a = Math.max(0, 0.05 + z2 * 0.05);
          ctx.beginPath();
          ctx.fillStyle = `rgba(190,205,235,${a})`;
          ctx.arc(sx, sy, Math.max(0.5, 1 * scale), 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.globalCompositeOperation = 'source-over';
      }

      const proj = new Array(points.length);
      let closestIdx = -1, closestDist = 9999;
      for (let i = 0; i < points.length; i++) {
        const p = points[i];
        let x = p.x * cosY - p.z * sinY;
        let z = p.x * sinY + p.z * cosY;
        let y2 = p.y * cosX - z * sinX;
        let z2 = p.y * sinX + z * cosX;

        let jx = 0, jy = 0, jz = 0;
        if (micActive && amp > 0.01) {
          const n = Math.sin(p.seed + now * 0.02) * amp * 0.08;
          const n2 = Math.cos(p.seed * 1.7 + now * 0.017) * amp * 0.08;
          jx = n; jy = n2; jz = n * 0.5;
        }

        const fx = (x + jx) * pulse;
        const fy = (y2 + jy) * pulse;
        const fz = (z2 + jz);

        const scale = 1 / (1.9 - fz * 0.55);
        let sx = cx + fx * R * scale;
        let sy = cy + fy * R * scale;

        if (pointerInside && !isDragging && pointerX !== null && pointerY !== null) {
          const ddx = sx - pointerX, ddy = sy - pointerY;
          const dist = Math.sqrt(ddx * ddx + ddy * ddy);
          const radius = 70;
          if (dist < radius && dist > 0.001) {
            const force = (1 - dist / radius) * 16;
            sx += (ddx / dist) * force;
            sy += (ddy / dist) * force;
            if (dist < closestDist) { closestDist = dist; closestIdx = i; }
          }
        }

        proj[i] = { sx, sy, z: fz, scale };
      }

      ctx.lineWidth = 0.7;
      for (const [a, b] of edges) {
        const pa = proj[a], pb = proj[b];
        const depth = (pa.z + pb.z) / 2;
        const alpha = Math.max(0, 0.14 + depth * 0.1);
        const isCore = coreSet.has(a) || coreSet.has(b);
        ctx.strokeStyle = isCore ? `rgba(200,215,255,${alpha + 0.08})` : `rgba(170,185,215,${alpha})`;
        ctx.beginPath();
        ctx.moveTo(pa.sx, pa.sy);
        ctx.lineTo(pb.sx, pb.sy);
        ctx.stroke();
      }

      const order = proj.map((p, i) => i).sort((i, j) => proj[i].z - proj[j].z);
      if (!isLightweight) {
        ctx.globalCompositeOperation = 'lighter';
      }
      for (const i of order) {
        const p = proj[i];
        const isCore = coreRgb.has(i);
        const isNear = i === closestIdx;
        const nearBoost = isNear ? (1 - closestDist / 70) : 0;
        const size = (isCore ? 3.4 : 1.5) * Math.max(0.6, p.scale) + nearBoost * 2.4;
        const alpha = 0.3 + p.scale * 0.45;

        ctx.beginPath();
        if (isCore) {
          const [r, g, b] = coreRgb.get(i);
          ctx.fillStyle = `rgba(${r},${g},${b},${Math.min(1, alpha + 0.25)})`;
          if (!isLightweight) {
            ctx.shadowColor = `rgba(${r},${g},${b},0.85)`;
            ctx.shadowBlur = 10 + clickPulse * 10 + nearBoost * 8;
          }
        } else if (isNear) {
          ctx.fillStyle = `rgba(255,255,255,${Math.min(1, alpha + 0.4)})`;
          if (!isLightweight) {
            ctx.shadowColor = 'rgba(255,255,255,0.8)';
            ctx.shadowBlur = 10 + nearBoost * 8;
          }
        } else {
          ctx.fillStyle = `rgba(180,195,225,${Math.min(1, alpha)})`;
          if (i % 3 === 0 && !isLightweight) {
            ctx.shadowColor = 'var(--blue)';
            ctx.shadowBlur = 10;
          } else if (!isLightweight) {
            ctx.shadowBlur = 0;
          }
        }
        ctx.arc(p.sx, p.sy, size, 0, Math.PI * 2);
        ctx.fill();
      }
      if (!isLightweight) {
        ctx.shadowBlur = 0;
        ctx.globalCompositeOperation = 'source-over';
      }
    }
    animFrame = requestAnimationFrame(draw);

    const micBtn = document.getElementById('micBtn');
    const micWarn = document.getElementById('micWarn');
    const statusEl = document.getElementById('statusIndicator');
    const statusText = document.getElementById('statusText');
    const commandBar = document.getElementById('commandBar');
    const eqBars = document.getElementById('eqBars');
    const eqBarEls = eqBars?.querySelectorAll('span');
    let freqData: any;

    function setStatus(live: boolean, label: string) {
      if (live) statusEl?.classList.add('live'); else statusEl?.classList.remove('live');
      if (statusText) statusText.textContent = label;
    }
    function showWarn(msg: string) {
      if (!micWarn) return;
      micWarn.textContent = msg;
      micWarn.classList.add('show');
      setTimeout(() => micWarn.classList.remove('show'), 4000);
    }

    function bandLevel(from: number, to: number) {
      let sum = 0, n = 0;
      for (let i = from; i < to; i++) { sum += freqData[i]; n++; }
      return n ? (sum / n) / 255 : 0;
    }

    function sampleAudioLoop() {
      if (!micActive) return;
      analyser.getByteTimeDomainData(dataArray);
      let sum = 0;
      for (let i = 0; i < dataArray.length; i++) {
        const d = (dataArray[i] - 128) / 128;
        sum += d * d;
      }
      const rms = Math.sqrt(sum / dataArray.length);
      ampTarget = Math.min(1, rms * 4.5);

      analyser.getByteFrequencyData(freqData);
      const bins = freqData.length;
      const low = bandLevel(0, Math.floor(bins * 0.12));
      const mid = bandLevel(Math.floor(bins * 0.12), Math.floor(bins * 0.35));
      const high = bandLevel(Math.floor(bins * 0.35), Math.floor(bins * 0.7));
      const levels = [low, mid, high];
      if (eqBarEls) {
        eqBarEls.forEach((el, i) => {
          const h = 5 + levels[i] * 22;
          (el as HTMLElement).style.height = h.toFixed(1) + 'px';
        });
      }

      requestAnimationFrame(sampleAudioLoop);
    }

    micBtn?.addEventListener('click', async () => {
      const promptInput = document.getElementById('promptInput') as HTMLTextAreaElement;
      
      if (micActive) {
        micActive = false; ampTarget = 0;
        micBtn.classList.remove('active');
        commandBar?.classList.remove('mic-live');
        updateBodyGlow(false, camActive);
        eqBars?.classList.remove('show');
        if (eqBarEls) eqBarEls.forEach(el => (el as HTMLElement).style.height = '5px');
        
        let wavBlob: Blob | null = null;
        if (audioDataRef.current.length > 0) {
          const merged = new Float32Array(audioLengthRef.current);
          let offset = 0;
          for (let i = 0; i < audioDataRef.current.length; i++) {
            merged.set(audioDataRef.current[i], offset);
            offset += audioDataRef.current[i].length;
          }
          wavBlob = encodeWAV(merged, sampleRateRef.current);
        }

        if (micStream) micStream.getTracks().forEach((tr: any) => tr.stop());
        if (audioCtx) audioCtx.close();
        if (recognition) {
          recognition.onresult = null;
          recognition.onend = null;
          recognition.stop();
        }
        if (silenceTimer) clearTimeout(silenceTimer);
        setStatus(false, 'idle');
        
        const transcript = promptInput ? promptInput.value.trim() : '';
        if (transcript) {
           handleSend(wavBlob);
        }
        return;
      }
      try {
        micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        const AudioContextClass = (window.AudioContext || (window as any).webkitAudioContext);
        audioCtx = new AudioContextClass();
        micSource = audioCtx.createMediaStreamSource(micStream);
        analyser = audioCtx.createAnalyser();
        analyser.fftSize = 256;
        dataArray = new Uint8Array(analyser.fftSize);
        freqData = new Uint8Array(analyser.frequencyBinCount);
        micSource.connect(analyser);
        
        // Setup Raw Audio Capture
        audioDataRef.current = [];
        audioLengthRef.current = 0;
        sampleRateRef.current = audioCtx.sampleRate;
        const scriptProcessor = audioCtx.createScriptProcessor(4096, 1, 1);
        scriptProcessor.onaudioprocess = (e: any) => {
          if (!micActive) return;
          const channelData = e.inputBuffer.getChannelData(0);
          audioDataRef.current.push(new Float32Array(channelData));
          audioLengthRef.current += channelData.length;
        };
        micSource.connect(scriptProcessor);
        const nullGain = audioCtx.createGain();
        nullGain.gain.value = 0;
        scriptProcessor.connect(nullGain);
        nullGain.connect(audioCtx.destination); // Connect to destination with 0 gain so it actually runs

        micActive = true;
        micBtn.classList.add('active');
        commandBar?.classList.add('mic-live');
        updateBodyGlow(true, camActive);
        eqBars?.classList.add('show');
        setStatus(true, 'listening');
        sampleAudioLoop();

        // Setup speech recognition
        if (recognition && promptInput) {
          let finalTranscript = "";
          promptInput.value = "";

          recognition.onresult = (event: any) => {
            let interim = "";
            for (let i = event.resultIndex; i < event.results.length; i++) {
              if (event.results[i].isFinal) finalTranscript += event.results[i][0].transcript;
              else interim += event.results[i][0].transcript;
            }
            promptInput.value = (finalTranscript + " " + interim).trim();
            promptInput.style.height = 'auto';
            promptInput.style.height = Math.min(120, promptInput.scrollHeight) + 'px';

            // Auto shut-off after 2 seconds of silence
            if (silenceTimer) clearTimeout(silenceTimer);
            silenceTimer = setTimeout(() => {
              if (promptInput.value.trim() && micActive) {
                micBtn.click(); // Programmatically turn off mic (which calls handleSend)
              }
            }, 2000);
          };
          recognition.onerror = (e: any) => console.log("Speech recognition error", e);
          recognition.onend = () => { if (micActive) recognition.start(); };
          recognition.start();
        }

      } catch (err) {
        showWarn('Microphone access was blocked or denied by the browser.');
      }
    }, { signal });

    const camBtn = document.getElementById('camBtn');
    const camPip = document.getElementById('cameraPip');
    const camVideo = document.getElementById('cameraVideo') as HTMLVideoElement;
    let camActive = false, camStream: any;

    camBtn?.addEventListener('click', async () => {
      if (camActive) {
        camActive = false;
        camBtn.classList.remove('active');
        camPip?.classList.remove('on');
        commandBar?.classList.remove('cam-live');
        updateBodyGlow(micActive, false);
        if (camStream) camStream.getTracks().forEach((tr: any) => tr.stop());
        if (camVideo) camVideo.srcObject = null;
        return;
      }
      try {
        camStream = await navigator.mediaDevices.getUserMedia({ video: true });
        if (camVideo) camVideo.srcObject = camStream;
        camActive = true;
        camBtn.classList.add('active');
        camPip?.classList.add('on');
        commandBar?.classList.add('cam-live');
        updateBodyGlow(micActive, true);
      } catch (err) {
        showWarn('Camera access was blocked or denied by the browser.');
      }
    }, { signal });

    const promptInput = document.getElementById('promptInput') as HTMLTextAreaElement;
    const sendBtn = document.getElementById('sendBtn');

    function pulseOnSend() {
      clickPulse = 1;
      ampTarget = Math.max(ampTarget, 0.4);
      setTimeout(() => { if (!micActive) ampTarget = 0; }, 450);
    }

    async function handleSend(audioBlob: Blob | null = null) {
      if (!promptInput || !promptInput.value.trim()) return;
      pulseOnSend();

      let transcript = promptInput.value.trim();
      promptInput.value = '';
      promptInput.style.height = 'auto';

      const passphrase = localStorage.getItem('ultron_voice_passphrase');
      if (passphrase && passphrase.trim()) {
        const passPattern = new RegExp(`^${passphrase.trim()}[,\\s]*`, 'i');
        if (!passPattern.test(transcript)) {
          addActivity('system', `Voice rejected: Missing passphrase`);
          speak("Voice not recognized or missing passphrase.");
          return;
        }
        // Strip the passphrase from the command sent to AI
        transcript = transcript.replace(passPattern, '').trim();
        if (!transcript) {
          addActivity('system', `Voice rejected: Empty command after passphrase`);
          speak("Passphrase accepted, but no command provided.");
          return;
        }
      }

      // --- Stage 0: Voice Biometric Verification ---
      const hasVoiceProfile = localStorage.getItem('ultron_voice_profile_registered') === 'true';
      if (audioBlob && hasVoiceProfile) {
        addActivity('system', 'Verifying voice biometrics...');
        try {
          const formData = new FormData();
          formData.append('audio', audioBlob, 'command.wav');
          const verifyRes = await fetch("/api/voice/verify", { method: "POST", body: formData });
          const verifyData = await verifyRes.json();
          if (!verifyData.verified) {
            addActivity('system', `Voice rejected: Biometrics failed (Score: ${verifyData.score})`);
            speak("Voice not recognized. Access denied.");
            return;
          }
        } catch (err: any) {
           console.error("Biometric verification error:", err);
        }
      }

      addActivity('voice', `Command: "${transcript.slice(0, 40)}${transcript.length > 40 ? '...' : ''}"`);

      const model = localStorage.getItem('ultron_model') || "llama-3.3-70b-versatile";
      const apiKey = localStorage.getItem('ultron_apikey') || "";

      try {
        // --- Stage 1: Intent ---
        // Use refs to avoid stale closure capturing empty state at mount time
        const currentDevices = devicesRef.current;
        const currentAliases = deviceAliasesRef.current;
        const currentHistory = chatHistoryRef.current;

        const devicesWithAliases = currentDevices.map(d => ({
          id: d.id.replace(/^adb-device-/, ''),  // strip internal prefix → real ADB serial
          alias: currentAliases[d.id] || d.name || d.id,
          name: d.name,
          model: d.model,
        }));
        
        setIsUltronThinking(true);
        const intentRes = await fetch("/api/voice/intent", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ transcript, model, apiKey, history: currentHistory, devices: devicesWithAliases }),
        });
        const intentData = await intentRes.json();
        setIsUltronThinking(false);

        if (intentData.detail || intentData.error) {
          addActivity('system', `Error: ${intentData.detail || intentData.error}`);
          speak("I encountered an error connecting to the AI.");
          return;
        }

        // Speak the acknowledgement immediately
        const ackText = intentData.response || "On it.";
        speak(ackText);
        addActivity('system', `Planning: ${ackText.slice(0, 50)}`);

        const commands = intentData.commands || [];
        const targetDeviceId = intentData.deviceId || null;
        if (commands.length === 0) return; // Conversational response only, no ADB needed

        if (commands.some((c: string) => c.startsWith("__WEB_SEARCH:"))) {
          setWebSearchLoading(true);
          setWebSearchResult(null);
        }

        // --- Stage 2: Execute ---
        addActivity('device', `Executing ${commands.length} command(s)${targetDeviceId ? ` on ${currentAliases[targetDeviceId] || targetDeviceId}` : ''}...`);
        const execRes = await fetch("/api/voice/execute", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ commands, deviceId: targetDeviceId }),
        });
        const execData = await execRes.json();
        const executed = execData.executed || [];

        setWebSearchLoading(false);

        // Check for Web Search Results
        const searchRes = executed.find((e: any) => e.searchResult);
        if (searchRes) {
          setWebSearchResult(searchRes.searchResult);
        }

        // --- Stage 3: Followup ---
        const followRes = await fetch("/api/voice/followup", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ originalTranscript: transcript, executed, model, apiKey, history: currentHistory }),
        });
        const followData = await followRes.json();
        const followText = followData.response || "Done.";
        speak(followText);

        // Update history (keep last 10)
        setChatHistory(prev => {
          const newHist = [...prev, { role: "user", content: transcript }, { role: "assistant", content: followText }];
          if (newHist.length > 10) return newHist.slice(newHist.length - 10);
          return newHist;
        });

        // Log result
        const hasErrors = executed.some((e: any) => e.status === "error");
        if (hasErrors) {
          const fail = executed.find((e: any) => e.status === "error");
          addActivity('system', `Failed: ${fail?.message || fail?.command || 'Unknown error'}`);
        } else {
          addActivity('system', `Completed successfully`);
        }

      } catch (err: any) {
        setWebSearchLoading(false);
        addActivity('system', `Error: ${err.message || err}`);
        speak("Something went wrong. Check the activity log for details.");
      }
    }
    sendBtn?.addEventListener('click', handleSend, { signal });
    promptInput?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
    }, { signal });
    promptInput?.addEventListener('input', () => {
      promptInput.style.height = 'auto';
      promptInput.style.height = Math.min(120, promptInput.scrollHeight) + 'px';
    }, { signal });

    return () => {
      ac.abort();
      cancelAnimationFrame(animFrame);
    };
  }, []);

  return (
    <div className="app">
      <header>
        <div className="wordmark">
          <span className="mark">
            <svg viewBox="0 0 24 24" fill="none"><path d="M12 1 22 12 12 23 2 12Z" stroke="url(#g)" strokeWidth="1.6" strokeLinejoin="round" /><defs><linearGradient id="g" x1="2" y1="1" x2="22" y2="23"><stop offset="0%" stopColor="#ff5a4e" /><stop offset="35%" stopColor="#ffc53d" /><stop offset="65%" stopColor="#3ddc97" /><stop offset="100%" stopColor="#4c8dff" /></linearGradient></defs></svg>
          </span>
          ULTRON
        </div>
        <nav className="tabs">
          <button className="tab-btn active" data-tab="ultron">Ultron</button>
          <button className="tab-btn" data-tab="devices">Devices</button>
          <button className="tab-btn" data-tab="activities">Activities</button>
          <button className="tab-btn" data-tab="settings">Settings</button>
        </nav>
        <div className="status" id="statusIndicator"><span className="led"></span><span id="statusText">idle</span></div>
      </header>

      <main>
        <div id="toast-container"></div>
        {/* ULTRON */}
        <section className="panel active" id="panel-ultron">
          <div className="orb-stage" id="orbStage">
            <div className="orb-ring"></div>
            <div className="orb-halo"></div>
            <canvas id="orbCanvas"></canvas>
            <div className="camera-pip" id="cameraPip">
              <video id="cameraVideo" autoPlay playsInline muted></video>
              <span className="pip-label">CAM</span>
            </div>
            <div className="hint">drag to rotate · move cursor to disturb · speak with mic on</div>
          </div>

          <div className="command-bar" id="commandBar">
            <div className="command-bar-inner">
              <textarea id="promptInput" rows={1} placeholder="Message Ultron…"></textarea>
              <div className="mic-group">
                <button className="icon-btn mic" id="micBtn" aria-label="Toggle microphone" title="Toggle microphone">
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.9" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="2" width="6" height="13" rx="3" /><path d="M5 11a7 7 0 0 0 14 0" /><path d="M12 18v3" /></svg>
                </button>
                <div className="eq-bars" id="eqBars"><span></span><span></span><span></span></div>
              </div>
              <button className="icon-btn cam" id="camBtn" aria-label="Toggle camera" title="Toggle camera">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round"><path d="M14.4 4H8.6L6.7 6.5H4a2 2 0 0 0-2 2v9.5a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8.5a2 2 0 0 0-2-2h-2.7L14.4 4Z" /><circle cx="12" cy="13" r="3.4" /></svg>
              </button>
              <button className="icon-btn send" id="sendBtn" aria-label="Send message" title="Send">
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round"><path d="M7 17 17 7" /><path d="M9 7h8v8" /></svg>
              </button>
            </div>
          </div>
          <div className="mic-warn" id="micWarn"></div>
        </section>

        {/* DEVICES */}
        <section className="panel" id="panel-devices">
          <div className="section-heading">Devices</div>
          <div className="section-sub">Everything currently paired with Ultron</div>

          <div style={{ marginBottom: "20px", marginTop: "16px" }}>
            <WifiConnectPanel
              onConnect={async (ip, port) => await deviceStateRef.current?.connectWifi(ip, port)}
              onScan={async () => await deviceStateRef.current?.scanMdns()}
              onPair={async (ip, port, code) => await deviceStateRef.current?.pairWifi(ip, port, code)}
            />
          </div>

          <div className="device-grid" id="deviceGrid">
            {devices.length === 0 && <div style={{ opacity: 0.5, fontSize: "14px", marginTop: "10px" }}>No devices connected.</div>}
            {devices.map(d => {
              const alias = deviceAliases[d.id];
              const rawId = d.id.replace('adb-device-', '');
              return (
                <div className="device-card" key={d.id}>
                  <div className="top-row">
                    <div className="device-icon">
                      <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" dangerouslySetInnerHTML={{ __html: icon[d.icon] || icon.smartphone }}></svg>
                    </div>
                    <div className={`device-status status-${d.state ? 'online' : 'offline'}`}>
                      <span className="led"></span>{d.state ? 'online' : 'offline'}
                    </div>
                  </div>
                  <div className="device-name">{alias || d.name}</div>
                  <div className="device-meta" style={{ fontSize: '11px', opacity: 0.5, marginBottom: '6px' }}>{rawId}</div>
                  <button
                    onClick={() => renameDevice(d.id)}
                    style={{
                      background: 'rgba(255,255,255,0.07)',
                      border: '1px solid rgba(255,255,255,0.12)',
                      borderRadius: '6px',
                      color: 'var(--fg)',
                      fontSize: '11px',
                      padding: '4px 10px',
                      cursor: 'pointer',
                      width: '100%',
                      marginTop: '4px',
                    }}
                  >
                    ✏️ {alias ? 'Rename' : 'Set Alias'}
                  </button>
                </div>
              );
            })}
          </div>
        </section>

        {/* ACTIVITIES */}
        <section className="panel" id="panel-activities">
          <div className="section-heading">Activities</div>
          <div className="section-sub">Recent events across your session</div>
          <div className="timeline" id="activityTimeline">
            {activities.length === 0 && <div style={{ opacity: 0.5, fontSize: "14px" }}>No recent activity.</div>}
            {activities.map((a, i) => (
              <div className="activity-item" key={i}>
                <div className="activity-bar" style={{ background: colorFor[a.tag] || colorFor.system }}></div>
                <div className="activity-body">
                  <div className="activity-title">{a.title}</div>
                  <div className="activity-time">{a.time}</div>
                </div>
                <div className="activity-tag">{a.tag}</div>
              </div>
            ))}
          </div>
        </section>

        {/* SETTINGS */}
        <section className="panel" id="panel-settings">
          {!isUnlocked ? (
            <div className="lock-screen">
              <svg className="lock-icon" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="3" y="11" width="18" height="11" rx="2" ry="2" /><path d="M7 11V7a5 5 0 0 1 10 0v4" /></svg>
              <h2>Restricted Access</h2>
              <p>Please enter the master password to configure Ultron.</p>
              <form onSubmit={handleUnlock} style={{ display: 'flex', gap: '8px' }}>
                <input
                  type="password"
                  className="settings-input"
                  placeholder="Master Password"
                  value={unlockPassword}
                  onChange={(e) => setUnlockPassword(e.target.value)}
                  style={{ width: '200px' }}
                />
                <button type="submit" className="settings-save-btn" style={{ marginTop: '0' }}>Unlock</button>
              </form>
            </div>
          ) : (
            <div className="settings-content unlocked">
              <div className="section-heading">Ultron Settings</div>
              <div className="section-sub">Configure AI integrations and system preferences.</div>

              <form onSubmit={handleSaveSettings}>
                <div className="settings-group">
                  <label className="settings-label">Text-to-Speech Volume: {Math.round(settings.volume * 100)}%</label>
                  <input
                    type="range"
                    className="settings-slider"
                    min="0" max="2" step="0.05"
                    value={settings.volume}
                    onChange={e => setSettings({ ...settings, volume: parseFloat(e.target.value) })}
                  />
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '11px', color: 'var(--text-dim)', marginTop: '2px' }}>
                    <span>0%</span><span>100%</span><span>200%</span>
                  </div>
                </div>

                <div className="settings-group">
                  <label className="settings-label">AI Model</label>
                  <div style={{ position: 'relative' }}>
                    <button
                      type="button"
                      className="settings-input"
                      onClick={() => setModelDropdownOpen(!modelDropdownOpen)}
                      style={{ width: '100%', textAlign: 'left', cursor: 'pointer', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}
                    >
                      <span>{{
                        'llama-3.3-70b-versatile': 'Llama 3.3 70B Versatile',
                        'llama-3.1-8b-instant': 'Llama 3.1 8B Instant',
                        'openai/gpt-oss-120b': 'OpenAI GPT 120B',
                        'openai/gpt-oss-20b': 'OpenAI GPT 20B',
                        'qwen/qwen3.6-27b': 'Qwen 3.6 27B',
                        'mixtral-8x7b-32768': 'Mixtral 8x7B',
                        'gemma2-9b-it': 'Gemma 2 9B',
                        'llama-3.1-70b-versatile': 'Llama 3.1 70B Versatile',
                      }[settings.model] || settings.model}</span>
                      <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5"><path d="M6 9l6 6 6-6" /></svg>
                    </button>
                    {modelDropdownOpen && (
                      <div className="custom-dropdown">
                        {[
                          { value: 'llama-3.3-70b-versatile', label: 'Llama 3.3 70B Versatile', desc: 'Best quality, slower' },
                          { value: 'llama-3.1-70b-versatile', label: 'Llama 3.1 70B Versatile', desc: 'Great quality, balanced' },
                          { value: 'llama-3.1-8b-instant', label: 'Llama 3.1 8B Instant', desc: 'Fastest, lighter tasks' },
                          { value: 'mixtral-8x7b-32768', label: 'Mixtral 8x7B', desc: 'MoE architecture, versatile' },
                          { value: 'gemma2-9b-it', label: 'Gemma 2 9B', desc: 'Google, compact & capable' },
                        ].map(m => (
                          <div
                            key={m.value}
                            className={`dropdown-item ${settings.model === m.value ? 'active' : ''}`}
                            onClick={() => { setSettings({ ...settings, model: m.value }); setModelDropdownOpen(false); }}
                          >
                            <div className="dropdown-item-label">{m.label}</div>
                            <div className="dropdown-item-desc">{m.desc}</div>
                            {settings.model === m.value && <svg className="dropdown-check" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="var(--green)" strokeWidth="3"><path d="M20 6L9 17l-5-5" /></svg>}
                          </div>
                        ))}
                      </div>
                    )}
                  </div>
                </div>

                <div className="settings-group">
                  <label className="settings-label">Groq API Key</label>
                  <input
                    type="password"
                    className="settings-input"
                    placeholder="gsk_..."
                    value={settings.apiKey}
                    onChange={e => setSettings({ ...settings, apiKey: e.target.value })}
                  />
                </div>

                <div className="settings-group">
                  <label className="settings-label">Android Lockscreen PIN (Optional)</label>
                  <input
                    type="password"
                    className="settings-input"
                    placeholder="1234"
                    value={settings.devicePin}
                    onChange={e => setSettings({ ...settings, devicePin: e.target.value })}
                  />
                  <div style={{ fontSize: '12px', color: 'var(--text-dim)', marginTop: '4px' }}>
                    If set, Ultron will automatically wake and unlock your device when it connects.
                  </div>
                </div>

                <div className="settings-group">
                  <label className="settings-label">Voice Security Passphrase (Optional)</label>
                  <input
                    type="password"
                    className="settings-input"
                    placeholder="e.g. Protocol Delta"
                    value={settings.voicePassphrase}
                    onChange={e => setSettings({ ...settings, voicePassphrase: e.target.value })}
                  />
                  <div style={{ fontSize: '12px', color: 'var(--text-dim)', marginTop: '4px' }}>
                    If set, you MUST begin your voice commands with this exact phrase (e.g., "Protocol Delta, open WhatsApp").
                  </div>
                </div>

                <div className="settings-group" style={{ flexDirection: 'row', alignItems: 'center', gap: '10px' }}>
                  <input
                    type="checkbox"
                    id="lwToggle"
                    checked={settings.lightweightMode}
                    onChange={e => setSettings({ ...settings, lightweightMode: e.target.checked })}
                    style={{ width: '20px', height: '20px', accentColor: 'var(--blue)' }}
                  />
                  <label htmlFor="lwToggle" className="settings-label" style={{ marginBottom: 0, cursor: 'pointer' }}>
                    Enable Lightweight Mode (Disable 3D Animation)
                  </label>
                </div>

                <button type="submit" className="settings-save-btn">Save Settings</button>
              </form>
            </div>
          )}
        </section>

        {/* Ultron Response Popup Modal (Glassmorphism, Highly Rounded & Layered) */}
        {(webSearchResult || webSearchLoading || ultronSpeech || isUltronThinking) && (
          <div style={{
            position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
            backgroundColor: 'transparent', zIndex: 9999,
            display: 'flex', alignItems: 'center', justifyContent: 'flex-end',
            paddingRight: '40px', paddingBottom: '40px'
          }}>
            <div style={{
              position: 'relative',
              width: 'fit-content',
              minWidth: '350px',
              maxWidth: '600px',
              background: 'rgba(20, 25, 40, 0.65)',
              backdropFilter: 'blur(24px)',
              WebkitBackdropFilter: 'blur(24px)',
              borderRadius: '24px',
              border: '1px solid rgba(255, 255, 255, 0.15)',
              padding: '24px',
              display: 'flex',
              flexDirection: 'column',
              fontFamily: '"JetBrains Mono", monospace',
              color: 'white'
            }}>
              <style>{`
                @keyframes cursorBlink {
                  0%, 100% { opacity: 1; }
                  50% { opacity: 0; }
                }
                @keyframes dotBounce {
                  0%, 100% { transform: translateY(0); opacity: 0.4; }
                  50% { transform: translateY(-4px); opacity: 1; }
                }
                .dot { display: inline-block; width: 6px; height: 6px; background-color: var(--blue); border-radius: 50%; margin: 0 3px; animation: dotBounce 1.2s infinite ease-in-out both; }
                .dot:nth-child(1) { animation-delay: -0.32s; }
                .dot:nth-child(2) { animation-delay: -0.16s; }
              `}</style>
              
              {/* Header with macOS style dots */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <div style={{ display: 'flex', gap: '8px' }}>
                  <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#ff5f56', boxShadow: 'inset 0 1px 2px rgba(255,255,255,0.2)' }} />
                  <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#ffbd2e', boxShadow: 'inset 0 1px 2px rgba(255,255,255,0.2)' }} />
                  <div style={{ width: '12px', height: '12px', borderRadius: '50%', background: '#27c93f', boxShadow: 'inset 0 1px 2px rgba(255,255,255,0.2)' }} />
                </div>
                <div style={{ display: 'flex', gap: '12px' }}>
                  {!webSearchLoading && webSearchResult && (
                    <button
                      onClick={() => {
                        navigator.clipboard.writeText(webSearchResult);
                        setWebSearchCopied(true);
                        setTimeout(() => setWebSearchCopied(false), 2000);
                      }}
                      style={{ background: 'rgba(255,255,255,0.1)', border: '1px solid rgba(255,255,255,0.05)', borderRadius: '50%', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: webSearchCopied ? 'var(--green)' : 'rgba(255,255,255,0.7)', cursor: 'pointer', transition: '0.2s' }}
                      title="Copy Result"
                    >
                      {webSearchCopied ? (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><polyline points="20 6 9 17 4 12"></polyline></svg>
                      ) : (
                        <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path></svg>
                      )}
                    </button>
                  )}
                  {!webSearchLoading && !isUltronThinking && (
                    <button
                      onClick={() => {
                        setWebSearchResult(null);
                        setWebSearchLoading(false);
                        setUltronSpeech(null);
                      }}
                      style={{ background: 'rgba(255,90,78,0.2)', border: '1px solid rgba(255,90,78,0.3)', borderRadius: '50%', width: '32px', height: '32px', display: 'flex', alignItems: 'center', justifyContent: 'center', color: 'var(--red)', cursor: 'pointer', transition: '0.2s' }}
                      title="Close"
                    >
                      <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"><line x1="18" y1="6" x2="6" y2="18"></line><line x1="6" y1="6" x2="18" y2="18"></line></svg>
                    </button>
                  )}
                </div>
              </div>

              {/* Title */}
              <h2 style={{ 
                fontFamily: '"JetBrains Mono", monospace', 
                fontSize: '15px', 
                fontWeight: 500, 
                margin: '0 0 12px 0', 
                background: 'linear-gradient(90deg, #4c8dff, #3ddc97)', 
                WebkitBackgroundClip: 'text', 
                WebkitTextFillColor: 'transparent',
                display: 'flex', 
                alignItems: 'center', 
                gap: '8px'
              }}>
                {isUltronThinking ? "Processing..." : (webSearchLoading || webSearchResult) ? "Web Search" : "Ultron Response"}
                {(webSearchLoading || isUltronThinking) && (
                  <div style={{ display: 'flex', marginLeft: '4px', transform: 'translateY(2px)' }}>
                    <span className="dot"></span>
                    <span className="dot"></span>
                    <span className="dot"></span>
                  </div>
                )}
              </h2>
              
              {/* Main Content Area */}
              <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
                {ultronSpeech && (
                  <div style={{
                    color: 'rgba(255,255,255,0.95)',
                    fontSize: '12px',
                    lineHeight: '1.6',
                    overflowWrap: 'break-word',
                    wordBreak: 'break-word',
                    whiteSpace: 'pre-wrap',
                    fontWeight: 300
                  }}>
                    {typedUltronSpeech}
                    {(!webSearchResult && typedUltronSpeech.length < ultronSpeech.length) && (
                      <span style={{ display: 'inline-block', width: '8px', height: '14px', background: 'var(--blue)', verticalAlign: 'middle', marginLeft: '4px', animation: 'cursorBlink 1s infinite', borderRadius: '4px' }}></span>
                    )}
                  </div>
                )}
                
                {webSearchResult && (
                  <div style={{
                    background: 'rgba(255, 255, 255, 0.05)',
                    border: '1px solid rgba(255, 255, 255, 0.08)',
                    borderRadius: '16px',
                    padding: '16px',
                    boxShadow: 'inset 0 2px 10px rgba(0,0,0,0.2)'
                  }}>
                    <div
                      className="markdown-body"
                      style={{
                        color: 'rgba(255,255,255,0.8)',
                        fontSize: '11px',
                        lineHeight: '1.6',
                        overflowWrap: 'break-word',
                        wordBreak: 'break-word',
                        whiteSpace: 'pre-wrap',
                        fontWeight: 300,
                        maxHeight: '50vh',
                        overflowY: 'auto'
                      }}
                    >
                      {renderMarkdown(typedWebSearchResult)}
                      {typedWebSearchResult.length < webSearchResult.length && (
                        <span style={{ display: 'inline-block', width: '8px', height: '13px', background: 'var(--blue)', verticalAlign: 'middle', marginLeft: '4px', animation: 'cursorBlink 1s infinite', borderRadius: '4px' }}></span>
                      )}
                    </div>
                  </div>
                )}
              </div>
            </div>
          </div>
        )}

      </main>
    </div>
  );
}
