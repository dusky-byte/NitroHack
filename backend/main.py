import os
import re
import json
from dotenv import load_dotenv
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware

# Try to load both .env and .env.local if they exist
load_dotenv(".env")
load_dotenv(".env.local")

# Import from our helpers
from backend.models import AndroidRequest, VoiceRequest, ExecuteRequest, FollowupRequest
from backend.adb import exec_adb, ADB_COMMANDS
from backend.ai import query_groq, query_groq_followup

app = FastAPI()

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

@app.post("/api/android")
async def android_route(req: AndroidRequest):
    req_type = req.type

    if req_type == "unlock":
        if not req.deviceId or not req.code:
            raise HTTPException(status_code=400, detail="Device ID and PIN code required")
        device_arg = f"-s {req.deviceId}"
        
        # 1. Wake screen
        exec_adb(f"{device_arg} shell input keyevent 26")
        
        # 2. Swipe up to dismiss lockscreen (wait briefly)
        import time
        time.sleep(0.5)
        exec_adb(f"{device_arg} shell input swipe 500 1500 500 500 100")
        
        # 3. Enter PIN
        time.sleep(0.5)
        exec_adb(f"{device_arg} shell input text {req.code}")
        
        # 4. Press Enter
        exec_adb(f"{device_arg} shell input keyevent 66")
        
        return {"success": True, "message": "Unlock sequence sent"}

    if req_type == "mdns":
        stdout, stderr, code = exec_adb("mdns services", timeout=1)
        lines = stdout.split("\n")
        services = []
        for line in lines:
            if "_adb-tls" in line:
                parts = line.strip().split()
                if len(parts) >= 3:
                    name = parts[0]
                    sType = parts[1]
                    ipPort = parts[2].split(":")
                    if len(ipPort) == 2:
                        services.append({
                            "name": name,
                            "type": "pairing" if "pairing" in sType else "connect",
                            "ip": ipPort[0],
                            "port": ipPort[1]
                        })
        return {"success": True, "services": services}

    if req_type == "pair":
        if not req.ip or not req.port or not req.code:
            raise HTTPException(status_code=400, detail="IP, port, and code required")
        stdout, stderr, code = exec_adb(f"pair {req.ip}:{req.port} {req.code}", timeout=10)
        
        if ("error" in stderr.lower() and "successfully paired" not in stderr.lower()) or \
           ("failed" in stdout.lower() or "error" in stdout.lower()):
            raise HTTPException(status_code=500, detail=stdout or stderr)
        return {"success": True, "stdout": stdout}

    if req_type == "connect":
        port = req.port or "5555"
        if not req.ip:
            raise HTTPException(status_code=400, detail="IP required")
        stdout, stderr, code = exec_adb(f"connect {req.ip}:{port}", timeout=5)
        
        if "cannot connect" in stdout.lower() or "failed to connect" in stdout.lower() or "error" in stdout.lower():
            raise HTTPException(status_code=500, detail=stdout.strip())
        return {"success": True, "stdout": stdout}

    if req_type == "disconnect":
        target = f" {req.target}" if req.target else ""
        stdout, stderr, code = exec_adb(f"disconnect{target}")
        return {"success": True, "stdout": stdout}

    if req_type == "action":
        if not req.action or req.action not in ADB_COMMANDS:
            raise HTTPException(status_code=400, detail="Invalid action")
        
        action_cmd = ADB_COMMANDS[req.action]
        device_arg = f"-s {req.deviceId}" if req.deviceId else ""
        stdout, stderr, code = exec_adb(f"{device_arg} {action_cmd}".strip())
        
        if "error" in stderr.lower():
            raise HTTPException(status_code=500, detail="ADB command failed.")
        return {"success": True, "stdout": stdout}

    raise HTTPException(status_code=400, detail="Invalid request type")


@app.get("/api/android")
async def get_android_devices():
    stdout, stderr, code = exec_adb("devices -l")
    if "error" in stderr.lower():
        return {"devices": []}
        
    lines = [l.strip() for l in stdout.split("\n") if l.strip()]
    raw_devices = []
    
    for line in lines[1:]:
        if "daemon" in line: continue
        parts = line.split()
        if len(parts) >= 2:
            did = parts[0]
            status = parts[1]
            model = did
            for p in parts:
                if p.startswith("model:"):
                    model = p.replace("model:", "").replace("_", " ")
            raw_devices.append({"id": did, "status": status, "model": model, "alias": ""})

    # Deduplicate by hardware serial number.
    # Two ADB entries (e.g. IP:port and mDNS) for the same physical device
    # will share the same ro.serialno. Keep only one entry per physical device,
    # preferring the IP:port form over the long mDNS name.
    seen_serials: dict = {}   # serial -> device dict
    for dev in raw_devices:
        if dev["status"] != "device":
            # Still include offline/unauthorized devices, just don't dedup them
            seen_serials[dev["id"]] = dev
            continue
        hw_out, _, _ = exec_adb(f"-s {dev['id']} shell getprop ro.serialno")
        hw_serial = hw_out.strip()
        if not hw_serial:
            seen_serials[dev["id"]] = dev
            continue
        if hw_serial not in seen_serials:
            seen_serials[hw_serial] = dev
        else:
            # Prefer simpler IP:port entry over long mDNS name
            existing = seen_serials[hw_serial]
            # An IP:port ID looks like "x.x.x.x:port" (short, contains dots+colon)
            def is_ip_port(did: str) -> bool:
                return "." in did and ":" in did and len(did) < 25
            if is_ip_port(dev["id"]) and not is_ip_port(existing["id"]):
                seen_serials[hw_serial] = dev  # replace mDNS with IP:port
    
    from backend.pc_executor import get_local_pc_id
    
    devices = list(seen_serials.values())
    
    # Append the local host PC
    pc_id = get_local_pc_id()
    devices.append({
        "id": pc_id,
        "status": "device",
        "model": "Local PC",
        "alias": "Computer"
    })
    
    return {"devices": devices}


# ---------------------------------------------------------------------------
#  Shared helpers for ADB command execution
# ---------------------------------------------------------------------------

def _lookup_contact_phone(contact_name: str, device_id: str = None) -> str:
    """Look up a phone number from the device's contacts by fuzzy name match."""
    flag = f"-s {device_id} " if device_id else ""
    # Use content://com.android.contacts/data/phones — already filtered to phone rows,
    # so no --where clause needed (avoids Windows shell quote-stripping issues).
    stdout, stderr, code = exec_adb(
        f'{flag}shell content query '
        '--uri content://com.android.contacts/data/phones '
        '--projection display_name:data1'
    )
    print(f"[Contacts] Looking up '{contact_name}', ADB returned {len(stdout.splitlines())} line(s), code={code}")
    if stderr.strip():
        print(f"[Contacts] stderr: {stderr.strip()[:200]}")

    lines = stdout.split("\n")
    for line in lines:
        line = line.strip()
        if not line: continue

        # Output format: Row: N display_name=Foo Bar, data1=+91...
        # Instead of complex regex, just strip the "Row: N " prefix and split by ", "
        if line.startswith("Row:"):
            line = line.split(" ", 2)[-1]  # removes "Row: 0 "
        
        parts = line.split(", ")
        name = None
        num = None
        for part in parts:
            if part.startswith("display_name="):
                name = part.split("=", 1)[1].strip()
            elif part.startswith("data1="):
                num = part.split("=", 1)[1].strip()

        if name and num:
            if contact_name.lower() in name.lower():
                cleaned = re.sub(r'[\s\-\(\)]', '', num)
                print(f"[Contacts] Matched '{name}' -> {cleaned}")
                return cleaned
        else:
            if "display_name=" in line or "data1=" in line:
                print(f"[Contacts] Unparsed line: {line[:120]}")
    print(f"[Contacts] No match found for '{contact_name}'")
    return ""




def _execute_commands(commands: list, device_id: str = None) -> list:
    """Execute a list of ADB commands/macros and return execution results."""
    from backend.pc_executor import execute_pc_commands, get_local_pc_id
    
    # If target is local PC or contains PC-specific commands, route to pc_executor
    if device_id == get_local_pc_id() or any(c.startswith("__PC_") or c.startswith("__WEB_SEARCH") for c in commands):
        return execute_pc_commands(commands)
        
    import time
    executed = []
    s = f"-s {device_id} " if device_id else ""

    for cmd in commands:
        if cmd.startswith("__CALL_CONTACT:"):
            contact = cmd.split(":", 1)[1]
            phone = _lookup_contact_phone(contact, device_id)
            if phone:
                c_out, c_err, c_code = exec_adb(f'{s}shell am start -a android.intent.action.CALL -d "tel:{phone}"')
                executed.append({"command": f"Call {contact}", "status": "success" if c_code == 0 else "error"})
            else:
                executed.append({"command": f"Call {contact}", "status": "error", "message": "Contact not found"})
        
        elif cmd.startswith("__WHATSAPP_MSG:"):
            parts = cmd.split(":", 2)
            if len(parts) >= 3:
                contact = parts[1]
                msg = parts[2]
                phone = _lookup_contact_phone(contact, device_id)
                if phone:
                    c_out, c_err, c_code = exec_adb(f'{s}shell am start -a android.intent.action.VIEW -d "whatsapp://send?phone={phone}&text={msg}"')
                    executed.append({"command": f"WhatsApp Msg to {contact}", "status": "success" if c_code == 0 else "error"})
                else:
                    executed.append({"command": f"WhatsApp Msg to {contact}", "status": "error", "message": "Contact not found"})
                    
        elif cmd.startswith("__WHATSAPP_FILE:"):
            parts = cmd.split(":", 2)
            if len(parts) >= 3:
                contact = parts[1]
                filepath = parts[2]
                phone = _lookup_contact_phone(contact, device_id)
                if phone:
                    if os.path.exists(filepath):
                        filename = os.path.basename(filepath)
                        p_out, p_err, p_code = exec_adb(f'{s}push "{filepath}" "/sdcard/Download/{filename}"')
                        if p_code == 0:
                            clean_phone = phone.replace("+", "")
                            intent_cmd = f'{s}shell am start -a android.intent.action.SEND -p com.whatsapp -e jid "{clean_phone}@s.whatsapp.net" --eu android.intent.extra.STREAM "file:///sdcard/Download/{filename}" -t "*/*"'
                            c_out, c_err, c_code = exec_adb(intent_cmd)
                            executed.append({"command": f"WhatsApp File to {contact}", "status": "success" if c_code == 0 else "error"})
                        else:
                            executed.append({"command": f"WhatsApp File to {contact}", "status": "error", "message": "Failed to push file to phone"})
                    else:
                        executed.append({"command": f"WhatsApp File to {contact}", "status": "error", "message": "File not found on PC"})
                else:
                    executed.append({"command": f"WhatsApp File to {contact}", "status": "error", "message": "Contact not found"})
                    
        elif cmd.startswith("__SPOTIFY_PLAY:"):
            song = cmd.split(":", 1)[1]
            exec_adb(f'{s}shell am start -a android.media.action.MEDIA_PLAY_FROM_SEARCH -p com.spotify.music --es query "{song}"')
            time.sleep(2)
            exec_adb(f'{s}shell input keyevent 66')
            time.sleep(1)
            exec_adb(f'{s}shell input keyevent 85')
            executed.append({"command": f"Play {song} on Spotify", "status": "success"})
                    
        else:
            c_out, c_err, c_code = exec_adb(f'{s}{cmd}')
            status = "error" if "error" in c_err.lower() or c_code != 0 else "success"
            executed.append({"command": cmd, "status": status, "message": c_err if status == "error" else c_out})

    return executed


def _get_api_key(req_api_key: str | None) -> str:
    """Resolve the API key from request or environment."""
    api_key = req_api_key or os.environ.get("GROQ_API_KEY")
    if not api_key or api_key == "your_api_key_here":
        raise HTTPException(status_code=401, detail="Missing GROQ_API_KEY in settings or env")
    return api_key


# ---------------------------------------------------------------------------
#  Stage 1: Intent — Parse the command and return an acknowledgement + commands
# ---------------------------------------------------------------------------

@app.post("/api/voice/intent")
async def voice_intent(req: VoiceRequest):
    if not req.transcript:
        raise HTTPException(status_code=400, detail="Transcript is required")

    api_key = _get_api_key(req.apiKey)
    ai_model = req.model or "llama-3.3-70b-versatile"

    print(f"[Voice Intent] User said: '{req.transcript}'")

    try:
        ai_msg = query_groq(req.transcript, api_key, ai_model, req.history, req.devices)
    except Exception as e:
        print(f"[ERROR] Groq API Failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    
    try:
        parsed = json.loads(ai_msg)
    except:
        return {"response": ai_msg, "commands": [], "deviceId": None}

    commands = parsed.get("commands", [])
    response_text = parsed.get("response", "On it.")
    device_id = parsed.get("deviceId", None)

    # Resolve alias → real ADB serial.
    # The AI may return an alias name (e.g. "y18") instead of the actual serial.
    # Walk through req.devices and do a case-insensitive match on alias, name, or id.
    if req.devices:
        if device_id:
            resolved = None
            for d in req.devices:
                d_alias = (d.get("alias") or "").lower()
                d_name = (d.get("name") or "").lower()
                d_id = (d.get("id") or "").lower()
                search = device_id.lower()
                if search == d_id or search in d_alias or search in d_name or d_alias in search or d_name in search:
                    resolved = d.get("id")
                    break
            if resolved:
                device_id = resolved
                print(f"[Voice Intent] Resolved alias '{parsed.get('deviceId')}' -> '{device_id}'")
            else:
                print(f"[Voice Intent] WARNING: Could not resolve deviceId '{device_id}' to any known device")
        else:
            # No device specified — default to first device to avoid "more than one device" ADB error
            device_id = req.devices[0].get("id")
            print(f"[Voice Intent] No device specified — defaulting to first: '{device_id}'")

    print(f"[Voice Intent] Acknowledgement: '{response_text}'")
    print(f"[Voice Intent] Commands: {commands}")
    print(f"[Voice Intent] Target device: {device_id}")

    return {"response": response_text, "commands": commands, "deviceId": device_id}


# ---------------------------------------------------------------------------
#  Stage 2: Execute — Run the ADB commands and return results
# ---------------------------------------------------------------------------

@app.post("/api/voice/execute")
async def voice_execute(req: ExecuteRequest):
    if not req.commands:
        return {"executed": []}
    
    print(f"[Voice Execute] Running {len(req.commands)} command(s) on device: {req.deviceId or 'default'}...")
    
    executed = _execute_commands(req.commands, req.deviceId)

    print(f"[Voice Execute] Results: {executed}")

    return {"executed": executed}


# ---------------------------------------------------------------------------
#  Stage 3: Followup — Generate a natural spoken response from results
# ---------------------------------------------------------------------------

@app.post("/api/voice/followup")
async def voice_followup(req: FollowupRequest):
    api_key = _get_api_key(req.apiKey)
    ai_model = req.model or "llama-3.3-70b-versatile"

    print(f"[Voice Followup] Generating follow-up for: '{req.originalTranscript}'")

    try:
        ai_msg = query_groq_followup(req.originalTranscript, req.executed, api_key, ai_model, req.history)
    except Exception as e:
        print(f"[ERROR] Groq Followup API Failed: {e}")
        # If the followup AI fails, generate a simple fallback
        has_errors = any(e.get("status") == "error" for e in req.executed)
        if has_errors:
            return {"response": "Something went wrong during execution. You might want to try that again."}
        return {"response": "Done. What else do you need?"}
    
    try:
        parsed = json.loads(ai_msg)
        return {"response": parsed.get("response", "Done.")}
    except:
        return {"response": ai_msg}


# ---------------------------------------------------------------------------
#  Legacy: Keep old /api/voice for backwards compat (used by old route.ts)
# ---------------------------------------------------------------------------

@app.post("/api/voice")
async def voice_route(req: VoiceRequest):
    if not req.transcript:
        raise HTTPException(status_code=400, detail="Transcript is required")

    api_key = _get_api_key(req.apiKey)
    ai_model = req.model or "llama-3.3-70b-versatile"

    print(f"[Voice API] User said: '{req.transcript}'")

    try:
        ai_msg = query_groq(req.transcript, api_key, ai_model)
    except Exception as e:
        print(f"[ERROR] Groq API (legacy) Failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))
    
    try:
        parsed = json.loads(ai_msg)
    except:
        return {"response": ai_msg, "executed": []}

    commands = parsed.get("commands", [])
    response_text = parsed.get("response", "Task executed.")

    executed = _execute_commands(commands)

    return {"response": response_text, "executed": executed}
