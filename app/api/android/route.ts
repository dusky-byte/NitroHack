import { NextResponse } from "next/server";
import { exec } from "child_process";
import util from "util";

import fs from "fs";
import path from "path";
import os from "os";

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
    const action = body.action as string;

    if (!action || !ADB_COMMANDS[action]) {
      return NextResponse.json({ error: "Invalid or unsupported action" }, { status: 400 });
    }

    const actionCommand = ADB_COMMANDS[action];
    const adbPath = getAdbCommand();
    const command = `${adbPath} ${actionCommand}`;
    
    console.log(`Executing ADB: ${command}`);
    
    // Execute the ADB command locally
    const { stdout, stderr } = await execPromise(command);

    // Some ADB commands log to stderr even when successful, but if it says "error:", we fail
    if (stderr && stderr.toLowerCase().includes("error")) {
      console.error("ADB Execution Error:", stderr);
      return NextResponse.json({ error: "ADB command failed. Is your device connected with USB debugging?" }, { status: 500 });
    }

    return NextResponse.json({ success: true, stdout });
  } catch (error: any) {
    console.error("API Route Error:", error);
    return NextResponse.json(
      { error: "Failed to execute command. Ensure ADB is in your PATH and device is authorized." },
      { status: 500 }
    );
  }
}
