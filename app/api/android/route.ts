import { NextResponse } from "next/server";
import { exec } from "child_process";
import util from "util";

import fs from "fs";
import path from "path";
import os from "os";
import { getAliases, saveAlias } from "../../../lib/deviceAliases";
import { logConnection, addActivity } from "../../../lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const execPromise = util.promisify(exec);

// Attempt to auto-detect ADB if it's not in PATH
function getAdbCommand(): string {
  const localAppData = path.join(os.homedir(), "AppData", "Local", "Android", "Sdk", "platform-tools", "adb.exe");
  const platformToolsDir = path.join(process.cwd(), "platform-tools", "adb.exe");
  const localDir = path.join(process.cwd(), "adb.exe");
  
  if (fs.existsSync(localAppData)) return `"${localAppData}"`;
  if (fs.existsSync(platformToolsDir)) return `"${platformToolsDir}"`;
  if (fs.existsSync(localDir)) return `"${localDir}"`;
  
  return "adb"; // Fallback to PATH
}

// Universal Android KeyEvents
const ADB_COMMANDS: Record<string, string> = {
  "media_play_pause": "shell input keyevent 85",
  "media_next":       "shell input keyevent 87",
  "media_prev":       "shell input keyevent 88",
  "volume_up":        "shell input keyevent 24",
  "volume_down":      "shell input keyevent 25",
  "volume_mute":      "shell input keyevent 164",
  "screen_power":     "shell input keyevent 26",
};

export async function POST(request: Request) {
  try {
    const body = await request.json();
    const type = body.type || "action";
    const adbPath = getAdbCommand();

    if (type === "mdns") {
      try {
        const command = `${adbPath} mdns services`;
        console.log(`Executing ADB: ${command}`);
        // ADB mdns services might block on some versions, use a timeout
        const { stdout } = await execPromise(command, { timeout: 1000 });
        
        const lines = stdout.split("\n");
        const services: Array<{ name: string; type: "pairing" | "connect"; ip: string; port: string }> = [];
        
        for (const line of lines) {
          if (line.includes("_adb-tls")) {
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 3) {
              const name = parts[0];
              const sType = parts[1];
              const ipPort = parts[2].split(":");
              if (ipPort.length === 2) {
                services.push({
                  name,
                  type: sType.includes("pairing") ? "pairing" : "connect",
                  ip: ipPort[0],
                  port: ipPort[1]
                });
              }
            }
          }
        }
        return NextResponse.json({ success: true, services });
      } catch (err: any) {
        // If it times out, err.stdout might contain the list already
        let stdout = err.stdout || "";
        const lines = stdout.split("\n");
        const services: Array<{ name: string; type: "pairing" | "connect"; ip: string; port: string }> = [];
        for (const line of lines) {
          if (line.includes("_adb-tls")) {
            const parts = line.trim().split(/\s+/);
            if (parts.length >= 3) {
              const name = parts[0];
              const sType = parts[1];
              const ipPort = parts[2].split(":");
              if (ipPort.length === 2) {
                services.push({
                  name,
                  type: sType.includes("pairing") ? "pairing" : "connect",
                  ip: ipPort[0],
                  port: ipPort[1]
                });
              }
            }
          }
        }
        return NextResponse.json({ success: true, services, note: "Timed out, returned partial list" });
      }
    }

    if (type === "pair") {
      const ip = body.ip as string;
      const port = body.port as string;
      const code = body.code as string;
      if (!ip || !port || !code) return NextResponse.json({ error: "IP, port, and pairing code required" }, { status: 400 });
      
      const command = `${adbPath} pair ${ip}:${port} ${code}`;
      console.log(`Executing ADB: ${command}`);
      try {
        const { stdout, stderr } = await execPromise(command, { timeout: 10000 });
        if (stderr && stderr.toLowerCase().includes("error") && !stderr.toLowerCase().includes("successfully paired")) {
          logConnection(ip, port, "Pairing Failed");
          return NextResponse.json({ error: stderr }, { status: 500 });
        }
        if (stdout.toLowerCase().includes("failed") || stdout.toLowerCase().includes("error")) {
          logConnection(ip, port, "Pairing Failed");
          return NextResponse.json({ error: stdout.trim() }, { status: 500 });
        }
        logConnection(ip, port, "Paired Successfully");
        addActivity("system", `Paired with ${ip}:${port}`);
        return NextResponse.json({ success: true, stdout });
      } catch (err: any) {
        logConnection(ip, port, "Pairing Failed");
        return NextResponse.json({ error: err.message || "Pairing failed" }, { status: 500 });
      }
    }

    if (type === "connect") {
      const ip = body.ip as string;
      const port = body.port || "5555";
      if (!ip) return NextResponse.json({ error: "IP address required" }, { status: 400 });
      const command = `${adbPath} connect ${ip}:${port}`;
      console.log(`Executing ADB: ${command}`);
      try {
        const { stdout, stderr } = await execPromise(command, { timeout: 5000 });
        if (stdout.toLowerCase().includes("cannot connect") || stdout.toLowerCase().includes("failed to connect") || stdout.toLowerCase().includes("error")) {
          logConnection(ip, port, "Connection Failed");
          return NextResponse.json({ error: stdout.trim() }, { status: 500 });
        }
        logConnection(ip, port, "Connected Successfully");
        addActivity("system", `Connected to ${ip}:${port}`);
        return NextResponse.json({ success: true, stdout, stderr });
      } catch (err: any) {
        logConnection(ip, port, "Connection Failed");
        return NextResponse.json({ error: err.message || "Connection failed" }, { status: 500 });
      }
    }

    if (type === "disconnect") {
      const target = body.target as string;
      const command = target ? `${adbPath} disconnect ${target}` : `${adbPath} disconnect`;
      const { stdout } = await execPromise(command);
      return NextResponse.json({ success: true, stdout });
    }

    if (type === "action") {
      const action = body.action as string;
      const deviceId = body.deviceId as string;

      if (!action || !ADB_COMMANDS[action]) {
        return NextResponse.json({ error: "Invalid or unsupported action" }, { status: 400 });
      }

      const actionCommand = ADB_COMMANDS[action];
      const deviceArg = deviceId ? `-s ${deviceId}` : "";
      const command = `${adbPath} ${deviceArg} ${actionCommand}`.trim();
      
      console.log(`Executing ADB: ${command}`);
      
      // Execute the ADB command locally
      const { stdout, stderr } = await execPromise(command);

      // Some ADB commands log to stderr even when successful, but if it says "error:", we fail
      if (stderr && stderr.toLowerCase().includes("error")) {
        console.error("ADB Execution Error:", stderr);
        return NextResponse.json({ error: "ADB command failed. Is your device connected with USB debugging?" }, { status: 500 });
      }

      return NextResponse.json({ success: true, stdout });
    }

    if (type === "set_alias") {
      const deviceId = body.deviceId as string;
      const alias = body.alias as string;
      if (!deviceId) return NextResponse.json({ error: "deviceId required" }, { status: 400 });
      
      saveAlias(deviceId, alias);
      return NextResponse.json({ success: true });
    }

    return NextResponse.json({ error: "Invalid request type" }, { status: 400 });
  } catch (error: any) {
    console.error("API Route Error:", error);
    return NextResponse.json(
      { error: "Failed to execute command. Ensure ADB is in your PATH and device is authorized." },
      { status: 500 }
    );
  }
}

export async function GET() {
  try {
    const adbPath = getAdbCommand();
    const command = `${adbPath} devices -l`;
    const { stdout, stderr } = await execPromise(command);

    if (stderr && stderr.toLowerCase().includes("error")) {
      return NextResponse.json({ devices: [] });
    }

    const lines = stdout.split('\n').map(l => l.trim()).filter(l => l);
    const devices = [];
    const aliases = getAliases();
    
    // Skip the first line "List of devices attached"
    for (let i = 1; i < lines.length; i++) {
      const line = lines[i];
      if (line.includes("daemon")) continue; // Skip daemon startup logs
      const parts = line.split(/\s+/);
      if (parts.length >= 2) {
        const id = parts[0];
        const status = parts[1];
        
        let model = id;
        for (const p of parts) {
          if (p.startsWith('model:')) {
            model = p.replace('model:', '').replace(/_/g, ' ');
          }
        }
        
        const alias = aliases[id];
        
        devices.push({ id, status, model, alias });
      }
    }
    
    return NextResponse.json({ devices });
  } catch (error: any) {
    console.error("ADB GET Error:", error);
    return NextResponse.json({ devices: [] });
  }
}
