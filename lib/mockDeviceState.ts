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
  category: "lighting" | "climate" | "security" | "appliances" | "android" | "pc";
  /** Min value for range-type devices */
  rangeMin?: number;
  /** Max value for range-type devices */
  rangeMax?: number;
  /** Display unit for range-type devices (e.g. "%", "°F") */
  rangeUnit?: string;
  /** The ADB action mapped to this device */
  actionId?: string;
  /** User-friendly name alias for ADB devices */
  alias?: string;
  /** The model name of the device */
  model?: string;
}

export type DeviceListener = (devices: Device[]) => void;

// We redefine our devices to map to the Android features we can control
const INITIAL_DEVICES: Device[] = [
  {
    id: "media-play-pause",
    name: "Play / Pause Media",
    icon: "music_note",
    type: "toggle",
    state: false,
    category: "android",
    actionId: "media_play_pause",
  },
  {
    id: "media-next",
    name: "Next Track",
    icon: "skip_next",
    type: "toggle",
    state: false,
    category: "android",
    actionId: "media_next",
  },
  {
    id: "screen-power",
    name: "Screen Lock / Wake",
    icon: "smartphone",
    type: "lock",
    state: true,
    category: "android",
    actionId: "screen_power",
  },
  {
    id: "volume-up",
    name: "Volume Up",
    icon: "volume_up",
    type: "toggle",
    state: false,
    category: "android",
    actionId: "volume_up",
  },
  {
    id: "volume-down",
    name: "Volume Down",
    icon: "volume_down",
    type: "toggle",
    state: false,
    category: "android",
    actionId: "volume_down",
  }
];

export class MockDeviceState {
  private devices: Device[];
  private listeners = new Set<DeviceListener>();
  private pollingInterval: ReturnType<typeof setInterval> | null = null;
  private abortController: AbortController | null = null;
  private isFetching = false;

  constructor() {
    this.devices = [];
    // Only fetch if running in browser
    if (typeof window !== "undefined") {
      this.fetchDevices();
      this.startPolling();
    }
  }

  private async fetchDevices() {
    // Skip if a fetch is already in flight
    if (this.isFetching) return;
    this.isFetching = true;

    // Cancel any lingering previous request
    if (this.abortController) {
      this.abortController.abort();
    }
    this.abortController = new AbortController();

    try {
      const res = await fetch("/api/android", { signal: this.abortController.signal });
      if (!res.ok) {
        // Route not ready yet (e.g. 404 during startup) — silently ignore
        return;
      }
      const data = await res.json();
      
      if (data.devices && data.devices.length > 0) {
        const connectedDevices: Device[] = data.devices.map((d: any) => ({
          id: `adb-device-${d.id}`,
          name: d.alias ? `${d.alias} (${d.model})` : `${d.model} (${d.status})`,
          icon: d.model === "Local PC" ? "laptop" : (d.status === "device" ? "smartphone" : "warning"),
          type: "toggle",
          state: d.status === "device",
          category: d.model === "Local PC" ? "pc" : "android",
          alias: d.alias,
          model: d.model,
        }));
        
        // Only show controls if there's an actual device connected
        this.devices = [...connectedDevices, ...INITIAL_DEVICES];
      } else {
        this.devices = [];
      }
      this.notify();
    } catch (err: any) {
      if (err.name !== "AbortError") {
        console.error("Failed to fetch devices:", err);
        this.devices = [];
        this.notify();
      }
    } finally {
      this.isFetching = false;
    }
  }

  private startPolling() {
    if (!this.pollingInterval) {
      // Poll every 20s instead of 10s to avoid terminal spam in dev mode
      this.pollingInterval = setInterval(() => this.fetchDevices(), 20000);
    }
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
      // Find a connected adb device to target, if any.
      const targetDevice = this.devices.find(d => d.id.startsWith("adb-device-") && d.state === true);
      const targetId = targetDevice ? targetDevice.id.replace("adb-device-", "") : undefined;
      
      this.executeAdbAction(device.actionId, targetId).catch(console.error);
    }

    this.notify();
    return { ...device };
  }

  setValue(deviceId: string, value: number): Device | null {
    // Currently, our basic ADB integration uses simple key events instead of range setting
    // But we keep this for interface compatibility
    return null;
  }

  async connectWifi(ip: string, port: string): Promise<void> {
    const res = await fetch("/api/android", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "connect", ip, port }),
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      throw new Error(data.error || "Failed to connect");
    }
    await this.fetchDevices();
  }

  async scanMdns(): Promise<Array<{ name: string; type: "pairing" | "connect"; ip: string; port: string }>> {
    const res = await fetch("/api/android", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "mdns" }),
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      throw new Error(data.error || "Failed to scan mDNS");
    }
    return data.services || [];
  }

  async pairWifi(ip: string, port: string, code: string): Promise<void> {
    const res = await fetch("/api/android", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "pair", ip, port, code }),
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      throw new Error(data.error || "Failed to pair");
    }
  }

  async setAlias(deviceId: string, alias: string): Promise<void> {
    const res = await fetch("/api/android", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ type: "set_alias", deviceId, alias }),
    });
    const data = await res.json();
    if (!res.ok || data.error) {
      throw new Error(data.error || "Failed to set alias");
    }
    await this.fetchDevices(); // Refresh list to get new alias
  }

  private async executeAdbAction(actionId: string, deviceId?: string) {
    try {
      const res = await fetch("/api/android", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type: "action", action: actionId, deviceId }),
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
