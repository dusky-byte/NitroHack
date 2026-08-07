"use client";

import { useState } from "react";

interface WifiConnectPanelProps {
  onConnect: (ip: string, port: string) => Promise<void>;
  onScan?: () => Promise<any>;
  onPair?: (ip: string, port: string, code: string) => Promise<void>;
}

export default function WifiConnectPanel({ onConnect, onScan, onPair }: WifiConnectPanelProps) {
  const [ip, setIp] = useState("");
  const [port, setPort] = useState("5555");
  const [code, setCode] = useState("");
  const [isPairingMode, setIsPairingMode] = useState(false);
  
  const [connecting, setConnecting] = useState(false);
  const [scanning, setScanning] = useState(false);
  const [status, setStatus] = useState<{ msg: string; ok: boolean } | null>(null);
  
  const [scannedDevices, setScannedDevices] = useState<any[]>([]);

  const handleScan = async () => {
    if (!onScan) return;
    setScanning(true);
    setStatus(null);
    try {
      const res = await onScan();
      if (Array.isArray(res)) {
        setScannedDevices(res);
        if (res.length === 0) {
          setStatus({ msg: "No devices found. Make sure the pairing dialog is open on your phone, then scan again.", ok: false });
        }
      }
    } catch (err: any) {
      setStatus({ msg: err.message || "Failed to scan network", ok: false });
    } finally {
      setScanning(false);
    }
  };

  const handleConnect = async () => {
    if (!ip) {
      setStatus({ msg: "IP address is required", ok: false });
      return;
    }
    setConnecting(true);
    setStatus(null);
    try {
      if (isPairingMode && onPair) {
        if (!code) throw new Error("Pairing code required");
        await onPair(ip, port, code);
        setIsPairingMode(false);
        setCode("");
        // After pairing, they must use the CONNECT port (which is different from pair port on Android 11+)
        setPort("");
        setStatus({ msg: "✓ Paired! Now scan again and click the 'connect' service to get your connection port.", ok: true });
      } else {
        await onConnect(ip, port);
        setStatus({ msg: `✓ Connected to ${ip}:${port}`, ok: true });
        setIp("");
        setPort("");
      }
    } catch (err: any) {
      setStatus({ msg: err.message || "Failed to connect", ok: false });
    } finally {
      setConnecting(false);
    }
  };

  return (
    <div className="wifi-connect-panel">
      {/* Header row */}
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
        <h3 className="device-name" style={{ margin: 0, fontSize: "16px" }}>Connect via Wi-Fi</h3>
        <div style={{ display: "flex", gap: "6px" }}>
          {/* Manual pair mode toggle */}
          <button
            onClick={() => { setIsPairingMode(p => !p); setStatus(null); setPort(isPairingMode ? "5555" : ""); }}
            className="wifi-btn"
            style={{ padding: "4px 8px", fontSize: "11px", width: "auto", opacity: isPairingMode ? 1 : 0.6 }}
            disabled={connecting}
          >
            {isPairingMode ? "→ Connect mode" : "Pair first"}
          </button>
          {onScan && (
            <button 
              onClick={handleScan} 
              className="wifi-btn" 
              style={{ padding: "4px 8px", fontSize: "11px", width: "auto" }}
              disabled={scanning || connecting}
            >
              {scanning ? "Scanning..." : "Scan"}
            </button>
          )}
        </div>
      </div>

      {/* Mode hint */}
      <div style={{ fontSize: "11px", opacity: 0.55, marginBottom: "8px" }}>
        {isPairingMode
          ? "📱 Open \"Pair device with pairing code\" on your phone — enter the IP, pairing port, and 6-digit code shown there."
          : "Enter the IP and port shown in Wireless Debugging settings, or scan to auto-discover."}
      </div>
      
      {/* Scanned devices */}
      {scannedDevices.length > 0 && (
        <div style={{ marginBottom: "10px", background: "rgba(0,0,0,0.2)", borderRadius: "6px", padding: "8px" }}>
          <div style={{ fontSize: "11px", opacity: 0.6, marginBottom: "4px" }}>Discovered:</div>
          {scannedDevices.map((d, i) => (
            <div 
              key={i} 
              style={{ display: "flex", justifyContent: "space-between", fontSize: "12px", padding: "4px 6px", cursor: "pointer", borderRadius: "4px", background: "rgba(255,255,255,0.05)", marginBottom: "3px" }}
              onClick={() => {
                setIp(d.ip);
                setPort(d.port);
                setIsPairingMode(d.type === "pairing");
                setStatus(null);
              }}
            >
              <span style={{ opacity: 0.8 }}>{d.type === "pairing" ? "🔑" : "📱"} {d.ip}:{d.port}</span>
              <span style={{ opacity: 0.5, fontSize: "11px" }}>{d.type}</span>
            </div>
          ))}
        </div>
      )}

      {/* Inputs */}
      <div className="wifi-inputs">
        <input 
          type="text" 
          placeholder="IP address" 
          value={ip} 
          onChange={(e) => setIp(e.target.value)} 
          className="wifi-input"
          disabled={connecting}
        />
        <input 
          type="text" 
          placeholder={isPairingMode ? "Pair port" : "Port"} 
          value={port} 
          onChange={(e) => setPort(e.target.value)} 
          className="wifi-input wifi-port"
          disabled={connecting}
        />
        {isPairingMode && (
          <input 
            type="text" 
            placeholder="6-digit code"
            value={code} 
            onChange={(e) => setCode(e.target.value)} 
            className="wifi-input wifi-port"
            disabled={connecting}
          />
        )}
        <button 
          onClick={handleConnect} 
          className="wifi-btn"
          disabled={connecting}
        >
          {connecting ? "..." : (isPairingMode ? "Pair" : "Connect")}
        </button>
      </div>

      {/* Status message */}
      {status && (
        <div style={{ fontSize: "12px", marginTop: "6px", color: status.ok ? "#6bffb8" : "#ff6b6b", lineHeight: 1.4 }}>
          {status.msg}
        </div>
      )}
    </div>
  );
}
