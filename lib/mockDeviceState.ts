// ——————————————————————————————————————————————
// Android Device State manager for UltraTouch.
// Now acts as a frontend bridge to our local ADB Next.js API route.
// ——————————————————————————————————————————————

export interface Device {
  id: string;
  name: string;
  icon: string;
  type: "toggle" | "range" | "lock";
  state: boolean | number;
  category: "lighting" | "climate" | "security" | "appliances" | "android";
  /** The ADB action mapped to this device */
  actionId?: string;
}

export type DeviceListener = (devices: Device[]) => void;

// We redefine our devices to map to the Android features we can control
const INITIAL_DEVICES: Device[] = [
  {
    id: "media-play-pause",
    name: "Play / Pause Media",
    icon: "🎵",
    type: "toggle",
    state: false,
    category: "android",
    actionId: "media_play_pause",
  },
  {
    id: "media-next",
    name: "Next Track",
    icon: "⏭️",
    type: "toggle",
    state: false,
    category: "android",
    actionId: "media_next",
  },
  {
    id: "screen-power",
    name: "Screen Lock / Wake",
    icon: "📱",
    type: "lock",
    state: true,
    category: "android",
    actionId: "screen_power",
  },
  {
    id: "volume-up",
    name: "Volume Up",
    icon: "🔊",
    type: "toggle",
    state: false,
    category: "android",
    actionId: "volume_up",
  },
  {
    id: "volume-down",
    name: "Volume Down",
    icon: "🔉",
    type: "toggle",
    state: false,
    category: "android",
    actionId: "volume_down",
  }
];

export class MockDeviceState {
  private devices: Device[];
  private listeners = new Set<DeviceListener>();

  constructor() {
    this.devices = INITIAL_DEVICES.map((d) => ({ ...d }));
  }

  subscribe(listener: DeviceListener): () => void {
    this.listeners.add(listener);
    listener(this.getDevices());
    return () => this.listeners.delete(listener);
  }

  getDevices(): Device[] {
    return this.devices.map((d) => ({ ...d }));
  }

  getDevice(id: string): Device | undefined {
    const d = this.devices.find((d) => d.id === id);
    return d ? { ...d } : undefined;
  }

  toggle(deviceId: string): Device | null {
    const device = this.devices.find((d) => d.id === deviceId);
    if (!device) return null;

    if (device.type === "toggle" || device.type === "lock") {
      device.state = !device.state; // locally toggle state for visual feedback
    }

    // Fire HTTP request to ADB backend asynchronously
    if (device.actionId) {
      this.executeAdbAction(device.actionId).catch(console.error);
    }

    this.notify();
    return { ...device };
  }

  setValue(deviceId: string, value: number): Device | null {
    // Currently, our basic ADB integration uses simple key events instead of range setting
    // But we keep this for interface compatibility
    return null;
  }

  private async executeAdbAction(actionId: string) {
    try {
      const res = await fetch("/api/android", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: actionId }),
      });
      const data = await res.json();
      if (!res.ok) {
        console.error("ADB Action Failed:", data.error);
        // You could emit an event here to show a toast in UI if needed
      }
    } catch (err) {
      console.error("Failed to fetch /api/android:", err);
    }
  }

  private notify(): void {
    const snapshot = this.getDevices();
    this.listeners.forEach((fn) => fn(snapshot));
  }
}
