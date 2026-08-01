import { NextResponse } from "next/server";
import { exec } from "child_process";
import util from "util";
import fs from "fs";
import path from "path";
import os from "os";

const execPromise = util.promisify(exec);

function getAdbCommand(): string {
  const localAppData = path.join(os.homedir(), "AppData", "Local", "Android", "Sdk", "platform-tools", "adb.exe");
  const localDir = path.join(process.cwd(), "adb.exe");
  
  if (fs.existsSync(localAppData)) return `"${localAppData}"`;
  if (fs.existsSync(localDir)) return `"${localDir}"`;
  
  return "adb"; // Fallback to PATH
}

const SYSTEM_PROMPT = `You are a translator that converts natural language into Android ADB shell commands.
The user will provide a spoken command. You must respond with ONLY a valid JSON array of strings, where each string is an ADB shell argument (omitting the word 'adb').

Available tools:
- Open an app / search: \`shell am start -a android.intent.action.SEARCH -p <package_name> --es query "<search_term>"\`
- Open a deep link: \`shell am start -a android.intent.action.VIEW -d "<url>"\`
- Press a key: \`shell input keyevent <number>\` (e.g. 26=power, 24=vol_up, 25=vol_down, 85=play/pause)
- Type text: \`shell input text "<text>"\`
- Tap screen: \`shell input tap <x> <y>\`

Examples:
"Open youtube and search for Mr Beast" -> ["shell am start -a android.intent.action.SEARCH -p com.google.android.youtube --es query \\"Mr Beast\\""]
"Play the next song" -> ["shell input keyevent 87"]
"Turn off the screen" -> ["shell input keyevent 26"]

Respond ONLY with the JSON array, no markdown formatting, no backticks.`;

export async function POST(request: Request) {
  try {
    const { transcript } = await request.json();
    
    if (!transcript) {
      return NextResponse.json({ error: "Transcript is required" }, { status: 400 });
    }

    const apiKey = process.env.GEMINI_API_KEY;
    if (!apiKey || apiKey === "your_api_key_here") {
      return NextResponse.json({ error: "Missing GEMINI_API_KEY in .env.local" }, { status: 401 });
    }

    console.log(`[Voice API] User said: "${transcript}"`);

    // Call Gemini API
    const response = await fetch(`https://generativelanguage.googleapis.com/v1beta/models/gemini-1.5-flash:generateContent?key=${apiKey}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        system_instruction: { parts: { text: SYSTEM_PROMPT } },
        contents: [{ parts: [{ text: transcript }] }],
        generationConfig: {
          temperature: 0.1,
          responseMimeType: "application/json",
        }
      })
    });

    if (!response.ok) {
      const err = await response.text();
      console.error("Gemini API Error:", err);
      return NextResponse.json({ error: "LLM Provider Error" }, { status: 502 });
    }

    const data = await response.json();
    const rawOutput = data.candidates?.[0]?.content?.parts?.[0]?.text;
    
    if (!rawOutput) {
      throw new Error("No output from LLM");
    }

    let commands: string[] = [];
    try {
      commands = JSON.parse(rawOutput);
    } catch (e) {
      console.error("Failed to parse LLM output:", rawOutput);
      return NextResponse.json({ error: "Failed to parse command from AI" }, { status: 500 });
    }

    console.log(`[Voice API] Generated Commands:`, commands);
    
    const adbPath = getAdbCommand();
    const results = [];

    // Execute commands sequentially
    for (const cmd of commands) {
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
