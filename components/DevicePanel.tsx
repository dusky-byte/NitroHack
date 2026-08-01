"use client";

import type { Device } from "@/lib/mockDeviceState";

interface DevicePanelProps {
  devices: Device[];
  focusedDevice: number;
  onFocusDevice: (index: number) => void;
  onToggleDevice: (deviceId: string) => void;
  onSetDeviceValue: (deviceId: string, value: number) => void;
  confirmingDevice: string | null;
}

const CATEGORY_ORDER = ["android", "lighting", "climate", "security", "appliances"] as const;
const CATEGORY_LABELS: Record<string, string> = {
  android: "Android Controls",
  lighting: "Lighting",
  climate: "Climate",
  security: "Security",
  appliances: "Appliances",
};

export default function DevicePanel({
  devices,
  focusedDevice,
  onFocusDevice,
  onToggleDevice,
  onSetDeviceValue,
  confirmingDevice,
}: DevicePanelProps) {
  // Group devices by category
  const grouped = CATEGORY_ORDER.map((cat) => ({
    category: cat,
    label: CATEGORY_LABELS[cat],
    items: devices.filter((d) => d.category === cat),
  })).filter((g) => g.items.length > 0);

  // Flat list for keyboard index tracking
  const flatDevices = grouped.flatMap((g) => g.items);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown" || e.key === "ArrowRight") {
      e.preventDefault();
      onFocusDevice(Math.min(focusedDevice + 1, flatDevices.length - 1));
    } else if (e.key === "ArrowUp" || e.key === "ArrowLeft") {
      e.preventDefault();
      onFocusDevice(Math.max(focusedDevice - 1, 0));
    } else if (e.key === "Enter" || e.key === " ") {
      e.preventDefault();
      const device = flatDevices[focusedDevice];
      if (device) {
        if (device.type === "range") {
          // Cycle through common values
          const curr = device.state as number;
          const step = ((device.rangeMax ?? 100) - (device.rangeMin ?? 0)) / 10;
          const next = curr + step > (device.rangeMax ?? 100)
            ? device.rangeMin ?? 0
            : curr + step;
          onSetDeviceValue(device.id, next);
        } else {
          onToggleDevice(device.id);
        }
      }
    }
  };

  let flatIndex = 0;

  return (
    <div
      className="device-panel"
      role="region"
      aria-label="Smart Devices"
      tabIndex={0}
      onKeyDown={handleKeyDown}
    >
      <h2 className="panel-title">Devices</h2>
      {grouped.map((group) => (
        <div key={group.category} className="device-category">
          <h3 className="device-category-label">{group.label}</h3>
          <div className="device-list" role="list">
            {group.items.map((device) => {
              const idx = flatIndex++;
              const isFocused = idx === focusedDevice;
              const isConfirming = confirmingDevice === device.id;
              const isOn =
                device.type === "toggle" || device.type === "lock"
                  ? (device.state as boolean)
                  : (device.state as number) > (device.rangeMin ?? 0);

              return (
                <div
                  key={device.id}
                  className={`device-card ${isFocused ? "focused" : ""} ${isOn ? "on" : "off"} ${isConfirming ? "confirming" : ""}`}
                  role="listitem"
                  tabIndex={isFocused ? 0 : -1}
                  aria-label={`${device.name}: ${formatState(device)}`}
                  onClick={() => {
                    if (device.type === "range") {
                      const curr = device.state as number;
                      const step = ((device.rangeMax ?? 100) - (device.rangeMin ?? 0)) / 10;
                      const next = curr + step > (device.rangeMax ?? 100)
                        ? device.rangeMin ?? 0
                        : curr + step;
                      onSetDeviceValue(device.id, next);
                    } else {
                      onToggleDevice(device.id);
                    }
                  }}
                  onMouseEnter={() => onFocusDevice(idx)}
                >
                  <div className="device-icon-wrap">
                    <span className="device-icon material-symbols-outlined">{device.icon}</span>
                  </div>
                  <div className="device-info">
                    <span className="device-name">{device.name}</span>
                    <span className="device-state">{formatState(device)}</span>
                  </div>
                  <div className="device-control">
                    {device.type === "range" ? (
                      <input
                        type="range"
                        min={device.rangeMin ?? 0}
                        max={device.rangeMax ?? 100}
                        value={device.state as number}
                        onChange={(e) => onSetDeviceValue(device.id, Number(e.target.value))}
                        className="device-slider"
                        aria-label={`${device.name} value`}
                        onClick={(e) => e.stopPropagation()}
                      />
                    ) : (
                      <div className={`device-toggle ${isOn ? "on" : ""}`}>
                        <div className="device-toggle-knob" />
                      </div>
                    )}
                  </div>
                  {device.type === "lock" && (
                    <span className="lock-badge material-symbols-outlined" aria-hidden="true">
                      {(device.state as boolean) ? "lock" : "lock_open"}
                    </span>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}
      <div aria-live="assertive" className="sr-only">
        {confirmingDevice && (() => {
          const d = devices.find((d) => d.id === confirmingDevice);
          return d ? `${d.name} ${formatState(d)}` : "";
        })()}
      </div>
    </div>
  );
}

function formatState(device: Device): string {
  if (device.type === "range") {
    return `${device.state}${device.rangeUnit ?? ""}`;
  }
  if (device.type === "lock") {
    return (device.state as boolean) ? "Locked" : "Unlocked";
  }
  return (device.state as boolean) ? "On" : "Off";
}
