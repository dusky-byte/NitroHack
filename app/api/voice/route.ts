import { NextResponse } from "next/server";
import { exec } from "child_process";
import util from "util";
import fs from "fs";
import path from "path";
import os from "os";
import { getAliases } from "../../../lib/deviceAliases";
import { addActivity } from "../../../lib/db";

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
The user will provide a spoken command. You must respond with ONLY a valid JSON object with a "commands" key containing an array of strings, and a "response" key containing a conversational string. Each string in commands is an ADB shell argument (omitting the word 'adb').

CRITICAL RULES:
1. ALWAYS use specific package names to avoid Android's app chooser/disambiguation dialog.
2. For calling contacts BY NAME, use the special command: __CALL_CONTACT:<name>  (the system will look up the real phone number automatically).
3. For calling a known phone number directly, use: shell am start -a android.intent.action.CALL -d "tel:<number>"
4. To open an app reliably, prefer: shell monkey -p <package> -c android.intent.category.LAUNCHER 1
5. If the user refers to a specific device by its alias or name (e.g. "My Phone"), you MUST prepend the ADB command with '-s <Device ID>'. Example: '-s 192.168.1.42:37253 shell monkey ...'
6. NEVER guess internal app Activity names (like .ContactPicker or .MainActivity). Stick to standard intents or 'monkey'.
7. To search within apps like WhatsApp, open the app first, then simulate a search using 'shell input keyevent 84' (Search key) or UI taps, then type the text.
8. You MUST include a "response" key with a cool, conversational reply (like JARVIS or a sci-fi AI). Keep it brief, confident, and natural. Do NOT describe the raw code or action in a robotic way.
9. Never output markdown, backticks, or explanations — only the JSON object.

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
- Play song on Spotify: shell am start -a android.media.action.MEDIA_PLAY_FROM_SEARCH -p com.spotify.music --es query "<song>"
- Open URL: shell am start -a android.intent.action.VIEW -d "<url>"
- Press key: shell input keyevent <number> (26=power, 24=vol_up, 25=vol_down, 85=play/pause, 87=next, 88=prev, 3=home, 4=back)
- Type text: shell input text "<text>"
- Swipe: shell input swipe <x1> <y1> <x2> <y2> <duration_ms>
- Call contact by name: __CALL_CONTACT:<name>
- Call number: shell am start -a android.intent.action.CALL -d "tel:<number>"

Examples:
User: "Open YouTube and search for Mr Beast"
Response: {"commands":["shell am start -a android.intent.action.SEARCH -p com.google.android.youtube --es query \\"Mr Beast\\""], "response": "Opening YouTube and searching for Mr Beast, sir."}

User: "Play the next song"
Response: {"commands":["shell input keyevent 87"], "response": "Skipping to the next track."}

User: "Play Blinding Lights on Spotify"
Response: {"commands":["shell am start -a android.media.action.MEDIA_PLAY_FROM_SEARCH -p com.spotify.music --es query \\"Blinding Lights\\""], "response": "Playing Blinding Lights on Spotify."}

User: "Call Amma"
Response: {"commands":["__CALL_CONTACT:Amma"], "response": "Dialing Amma now."}

User: "Call 9876543210"
Response: {"commands":["shell am start -a android.intent.action.CALL -d \\"tel:9876543210\\""], "response": "Initiating call."}

User: "Open gallery"
Response: {"commands":["shell monkey -p com.google.android.apps.photos -c android.intent.category.LAUNCHER 1"], "response": "Opening your photos gallery."}

User: "Turn on the flashlight"
Response: {"commands":["shell cmd statusbar expand-settings","shell input tap 540 300"], "response": "Illuminating the flashlight."}

Respond ONLY with the JSON object.`;

async function resolveContactCall(contactName: string, adbPath: string, deviceId: string): Promise<{ command: string; success: boolean; message: string }> {
  const target = deviceId ? `-s ${deviceId} ` : "";
  // Fetch all phone contacts to avoid shell escaping issues with % and quotes
  const queryCmd = `${adbPath} ${target}shell content query --uri content://com.android.contacts/data --projection display_name:data1 --where "mimetype='vnd.android.cursor.item/phone_v2'"`;

  console.log(`[Contact Lookup] Fetching all contacts to find "${contactName}"`);

  try {
    const { stdout, stderr } = await execPromise(queryCmd);

    if (stderr && stderr.toLowerCase().includes("error")) {
      return { command: "", success: false, message: `Contact query failed: ${stderr}` };
    }

    const lines = stdout.split('\\n');
    let phoneNumber = "";
    let matchedName = "";
    const searchName = contactName.toLowerCase().trim();

    for (const line of lines) {
      // Row: 0 display_name=Amma, data1=+919876543210
      const nameMatch = line.match(/display_name=(.*?),/);
      const phoneMatch = line.match(/data1=(.*?)(?:,|$)/);
      
      if (nameMatch && phoneMatch) {
        const name = nameMatch[1].trim();
        const num = phoneMatch[1].trim();
        
        if (name.toLowerCase().includes(searchName)) {
          phoneNumber = num;
          matchedName = name;
          break; // Stop at first match
        }
      }
    }

    if (!phoneNumber) {
      console.log(`[Contact Lookup] No match for "${contactName}"`);
      return { command: "", success: false, message: `Contact "${contactName}" not found on device.` };
    }

    console.log(`[Contact Lookup] Found: ${matchedName} -> ${phoneNumber}`);

    // Make the actual call
    const callCmd = `${adbPath} ${target}shell am start -a android.intent.action.CALL -d "tel:${phoneNumber}"`;
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
    const { transcript, model, apiKey: bodyApiKey } = await request.json();

    if (!transcript) {
      return NextResponse.json({ error: "Transcript is required" }, { status: 400 });
    }

    const apiKey = bodyApiKey || process.env.GROQ_API_KEY;
    const aiModel = model || "llama-3.3-70b-versatile";

    if (!apiKey || apiKey === "your_api_key_here") {
      return NextResponse.json({ error: "Missing GROQ_API_KEY in settings or .env.local" }, { status: 401 });
    }

    console.log(`[Voice API] User said: "${transcript}"`);

    const adbPath = getAdbCommand();
    
    // Fetch connected devices and aliases to inject into the prompt
    let devicesList = "";
    let firstDeviceId = "";
    try {
      const { stdout } = await execPromise(`${adbPath} devices -l`);
      const lines = stdout.split('\n').map(l => l.trim()).filter(l => l);
      const aliases = getAliases();
      for (let i = 1; i < lines.length; i++) {
        const line = lines[i];
        if (line.includes("daemon")) continue;
        const parts = line.split(/\s+/);
        if (parts.length >= 2) {
          const id = parts[0];
          const alias = aliases[id];
          devicesList += `- Device ID: ${id} (Alias/Name: "${alias || "None"}")\n`;
          if (!firstDeviceId) firstDeviceId = id;
        }
      }
    } catch (e) {
      console.error("Failed to list devices for prompt", e);
    }

    const dynamicPrompt = `${SYSTEM_PROMPT}

Currently Connected Devices:
${devicesList || "No devices connected."}`;

    // Call Groq API (OpenAI-compatible)
    const response = await fetch("https://api.groq.com/openai/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model: aiModel,
        messages: [
          { role: "system", content: dynamicPrompt },
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
    let aiResponse = "Executing command.";
    try {
      const parsed = JSON.parse(rawOutput);
      commands = Array.isArray(parsed) ? parsed : (parsed.commands ?? parsed.result ?? []);
      if (parsed.response) aiResponse = parsed.response;
    } catch (e) {
      console.error("Failed to parse LLM output:", rawOutput);
      return NextResponse.json({ error: "Failed to parse command from AI" }, { status: 500 });
    }

    console.log(`[Voice API] Generated Commands:`, commands);

    const results = [];

    // Execute commands sequentially
    for (const cmd of commands) {
      // Handle special contact-call command
      if (cmd.startsWith("__CALL_CONTACT:")) {
        const contactName = cmd.replace("__CALL_CONTACT:", "").trim();
        console.log(`[Voice API] Resolving contact: "${contactName}"`);
        const result = await resolveContactCall(contactName, adbPath, firstDeviceId);
        results.push({ command: cmd, status: result.success ? "success" : "error", message: result.message });
        continue;
      }

      let fullCommand = "";
      if (cmd.startsWith("shell ") && firstDeviceId && !cmd.includes("-s ")) {
        // Auto-prepend device ID if missing and there are multiple devices
        fullCommand = `${adbPath} -s ${firstDeviceId} ${cmd}`;
      } else {
        fullCommand = `${adbPath} ${cmd}`;
      }
      
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

    addActivity('voice', `Cmd: "${transcript}" -> Actions: ${commands.join(', ')}`);

    return NextResponse.json({ success: true, executed: results, response: aiResponse });
  } catch (error: any) {
    console.error("API Route Error:", error);
    return NextResponse.json({ error: "Internal server error" }, { status: 500 });
  }
}
