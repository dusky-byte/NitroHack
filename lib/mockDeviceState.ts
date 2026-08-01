// ——————————————————————————————————————————————
// Mock smart-device state manager for UltraTouch.
// Simulates IoT devices; swap this class for a real API client
// (e.g., Home Assistant, SmartThings) without changing consumers.
// ——————————————————————————————————————————————

export interface Device {
  id: string;
  name: string;
  icon: string;
  type: "toggle" | "range" | "lock";
  state: boolean | number;
  category: "lighting" | "climate" | "security" | "appliances";
  /** For range devices: minimum value */
  rangeMin?: number;
  /** For range devices: maximum value */
  rangeMax?: number;
  /** For range devices: unit label */
  rangeUnit?: string;
}

export type DeviceListener = (devices: Device[]) => void;

const INITIAL_DEVICES: Device[] = [
  {
    id: "living-light",
    name: "Living Room Light",
    icon: "💡",
    type: "toggle",
    state: true,
    category: "lighting",
  },
  {
    id: "kitchen-light",
    name: "Kitchen Light",
    icon: "💡",
    type: "toggle",
    state: false,
    category: "lighting",
  },
  {
    id: "bedroom-light",
    name: "Bedroom Light",
    icon: "🔆",
    type: "toggle",
    state: false,
    category: "lighting",
  },
  {
    id: "thermostat",
    name: "Thermostat",
    icon: "🌡",
    type: "range",
    state: 72,
    category: "climate",
    rangeMin: 60,
    rangeMax: 85,
    rangeUnit: "°F",
  },
  {
    id: "bedroom-fan",
    name: "Bedroom Fan",
    icon: "🌀",
    type: "toggle",
    state: false,
    category: "climate",
  },
  {
    id: "front-lock",
    name: "Front Door Lock",
    icon: "🔒",
    type: "lock",
    state: true,
    category: "security",
  },
  {
    id: "garage-door",
    name: "Garage Door",
    icon: "🚗",
    type: "toggle",
    state: false,
    category: "security",
  },
  {
    id: "coffee-maker",
    name: "Coffee Maker",
    icon: "☕",
    type: "toggle",
    state: false,
    category: "appliances",
  },
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
      device.state = !device.state;
    }

    this.notify();
    return { ...device };
  }

  setValue(deviceId: string, value: number): Device | null {
    const device = this.devices.find((d) => d.id === deviceId);
    if (!device || device.type !== "range") return null;

    const min = device.rangeMin ?? 0;
    const max = device.rangeMax ?? 100;
    device.state = Math.max(min, Math.min(max, Math.round(value)));

    this.notify();
    return { ...device };
  }

  private notify(): void {
    const snapshot = this.getDevices();
    this.listeners.forEach((fn) => fn(snapshot));
  }
}
