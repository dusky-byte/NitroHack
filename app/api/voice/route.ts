import { NextResponse } from "next/server";
import { exec } from "child_process";
import util from "util";
import fs from "fs";
import path from "path";
import os from "os";

const execPromise = util.promisify(exec);

function getAdbCommand(): string {
  const localAppData = path.join(os.homedir(), "AppData", "Local", "Android", "Sdk", "platform-tools", "adb.exe");
  const platformToolsDir = path.join(process.cwd(), "platform-tools", "adb.exe");
  const localDir = path.join(process.cwd(), "adb.exe");

  if (fs.existsSync(localAppData)) return `"${localAppData}"`;
  if (fs.existsSync(platformToolsDir)) return `"${platformToolsDir}"`;
  if (fs.existsSync(localDir)) return `"${localDir}"`;

  return "adb"; // Fallback to PATH
}

const SYSTEM_PROMPT = `You are a translator that converts natural language into Android ADB shell commands.
The user will provide a spoken command. You must respond with ONLY a valid JSON object with a "commands" key containing an array of strings. Each string is an ADB shell argument (omitting the word 'adb').

CRITICAL RULES:
1. ALWAYS use specific package names to avoid Android's app chooser/disambiguation dialog.
2. For calling contacts BY NAME, use the special command: __CALL_CONTACT:<name>  (the system will look up the real phone number automatically).
3. For calling a known phone number directly, use: shell am start -a android.intent.action.CALL -d "tel:<number>"
4. To open an app reliably, prefer: shell monkey -p <package> -c android.intent.category.LAUNCHER 1
5. Never output markdown, backticks, or explanations — only the JSON object.

Common package names:
- YouTube: com.google.android.youtube
- WhatsApp: com.whatsapp
- Instagram: com.instagram.android
- Chrome: com.android.chrome
- Google Photos: com.google.android.apps.photos
- Gallery (Samsung): com.sec.android.gallery3d
- Camera: com.sec.android.app.camera (Samsung) / com.android.camera2
- Phone/Dialer: com.android.dialer / com.samsung.android.dialer
- Messages: com.google.android.apps.messaging
- Settings: com.android.settings
- Maps: com.google.android.apps.maps
- Gmail: com.google.android.gm
- Spotify: com.spotify.music
- Twitter/X: com.twitter.android
- Telegram: org.telegram.messenger
- Netflix: com.netflix.mediaclient
- Clock: com.android.deskclock / com.sec.android.app.clockpackage
- Calculator: com.android.calculator2
- Files: com.google.android.documentsui

Available ADB tools:
- Open app: shell monkey -p <package> -c android.intent.category.LAUNCHER 1
- Search in app: shell am start -a android.intent.action.SEARCH -p <package> --es query "<term>"
- Open URL: shell am start -a android.intent.action.VIEW -d "<url>"
- Press key: shell input keyevent <number> (26=power, 24=vol_up, 25=vol_down, 85=play/pause, 87=next, 88=prev, 3=home, 4=back)
- Type text: shell input text "<text>"
- Swipe: shell input swipe <x1> <y1> <x2> <y2> <duration_ms>
- Call contact by name: __CALL_CONTACT:<name>
- Call number: shell am start -a android.intent.action.CALL -d "tel:<number>"

Examples:
User: "Open YouTube and search for Mr Beast"
Response: {"commands":["shell am start -a android.intent.action.SEARCH -p com.google.android.youtube --es query \\"Mr Beast\\""]}

User: "Play the next song"
Response: {"commands":["shell input keyevent 87"]}

User: "Call Amma"
Response: {"commands":["__CALL_CONTACT:Amma"]}

User: "Call 9876543210"
Response: {"commands":["shell am start -a android.intent.action.CALL -d \\"tel:9876543210\\""]}

User: "Open gallery"
Response: {"commands":["shell monkey -p com.google.android.apps.photos -c android.intent.category.LAUNCHER 1"]}

User: "Turn on the flashlight"
Response: {"commands":["shell cmd statusbar expand-settings","shell input tap 540 300"]}

Respond ONLY with the JSON object.`;

/**
 * Resolve a contact name to a phone number via ADB content query,
 * then return the ADB command to call that number.
 */
async function resolveContactCall(contactName: string, adbPath: string): Promise<{ command: string; success: boolean; message: string }> {
  // Query Android contacts for the name
  const queryCmd = `${adbPath} shell content query --uri content://com.android.contacts/data --projection display_name:data1 --where "mimetype='vnd.android.cursor.item/phone_v2' AND display_name LIKE '%${contactName}%'"`;

  console.log(`[Contact Lookup] ${queryCmd}`);

  try {
    const { stdout, stderr } = await execPromise(queryCmd);

    if (stderr && stderr.toLowerCase().includes("error")) {
      return { command: "", success: false, message: `Contact query failed: ${stderr}` };
    }

    // Parse output like: Row: 0 display_name=Amma, data1=+919876543210
    const match = stdout.match(/data1=([^\s,]+)/);
    if (!match) {
      // Fallback: open dialer and type the name so user can pick
      console.log(`[Contact Lookup] No match for "${contactName}", falling back to dialer search`);
      const fallbackCmd = `${adbPath} shell am start -a android.intent.action.DIAL`;
      await execPromise(fallbackCmd);
      // Small delay then type the name
      await new Promise((r) => setTimeout(r, 800));
      const typeCmd = `${adbPath} shell input text "${contactName.replace(/ /g, "%s")}"`;
      await execPromise(typeCmd);
      return { command: typeCmd, success: true, message: `Opened dialer and searched for "${contactName}"` };
    }

    const phoneNumber = match[1];
    console.log(`[Contact Lookup] Found: ${contactName} -> ${phoneNumber}`);

    // Make the actual call
    const callCmd = `${adbPath} shell am start -a android.intent.action.CALL -d "tel:${phoneNumber}"`;
    const { stderr: callErr } = await execPromise(callCmd);
    if (callErr && callErr.toLowerCase().includes("error")) {
      return { command: callCmd, success: false, message: `Call failed: ${callErr}` };
    }

    return { command: callCmd, success: true, message: `Calling ${contactName} (${phoneNumber})` };
  } catch (err: any) {
    return { command: "", success: false, message: `Contact lookup error: ${err.message}` };
  }
}

export async function POST(request: Request) {
  try {
    const { transcript } = await request.json();

    if (!transcript) {
      return NextResponse.json({ error: "Transcript is required" }, { status: 400 });
    }

    const apiKey = process.env.GROQ_API_KEY;
    if (!apiKey || apiKey === "your_api_key_here") {
      return NextResponse.json({ error: "Missing GROQ_API_KEY in .env.local" }, { status: 401 });
    }

    console.log(`[Voice API] User said: "${transcript}"`);

    // Call Groq API (OpenAI-compatible)
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: "llama-3.3-70b-versatile",
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: transcript },
        ],
        temperature: 0.1,
        response_format: { type: "json_object" },
      }),
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("Groq API Error:", err);
      return NextResponse.json({ error: "LLM Provider Error" }, { status: 502 });
    }

    const data = await response.json();
    const rawOutput = data.choices?.[0]?.message?.content;

    if (!rawOutput) {
      throw new Error("No output from LLM");
    }

    let commands: string[] = [];
    try {
      const parsed = JSON.parse(rawOutput);
      commands = Array.isArray(parsed) ? parsed : (parsed.commands ?? parsed.result ?? []);
    } catch (e) {
      console.error("Failed to parse LLM output:", rawOutput);
      return NextResponse.json({ error: "Failed to parse command from AI" }, { status: 500 });
    }

    console.log(`[Voice API] Generated Commands:`, commands);

    const adbPath = getAdbCommand();
    const results = [];

    // Execute commands sequentially
    for (const cmd of commands) {
      // Handle special contact-call command
      if (cmd.startsWith("__CALL_CONTACT:")) {
        const contactName = cmd.replace("__CALL_CONTACT:", "").trim();
        console.log(`[Voice API] Resolving contact: "${contactName}"`);
        const result = await resolveContactCall(contactName, adbPath);
        results.push({ command: cmd, status: result.success ? "success" : "error", message: result.message });
        continue;
      }

      const fullCommand = `${adbPath} ${cmd}`;
      console.log(`Executing: ${fullCommand}`);
      try {
        const { stdout, stderr } = await execPromise(fullCommand);
        if (stderr && stderr.toLowerCase().includes("error")) {
          console.error("ADB Execution Error:", stderr);
          throw new Error(stderr);
        }
        results.push({ command: cmd, status: "success" });
      } catch (err: any) {
        console.error(`Error executing ${cmd}:`, err.message);
        results.push({ command: cmd, status: "error", message: err.message });
      }
    }

    return NextResponse.json({ success: true, executed: results });
  } catch (error: any) {
    console.error("API Route Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
