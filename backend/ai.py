import os
import requests

import json

ANDROID_PROMPT = """You are Ultron, a highly advanced, slightly snarky AI assistant running locally on a user's computer.
You have the ability to control the user's Android phone via ADB.
Analyze the user's request. If it can be fulfilled by one or more of the available ADB tools, return a JSON object containing a `commands` array with the exact shell commands to execute, and a `response` string summarizing what you are doing.
If no tool is relevant, just return a conversational `response`.

Target Device ID: {device_id}

Available ADB tools:
- Open app: shell monkey -p <package> -c android.intent.category.LAUNCHER 1
- Search in app: shell am start -a android.intent.action.SEARCH -p <package> --es query "<term>"
- Play song on Spotify: __SPOTIFY_PLAY:<song_name>
- Open URL: shell am start -a android.intent.action.VIEW -d "<url>"
- Press key: shell input keyevent <number> (26=power, 24=vol_up, 25=vol_down, 85=play/pause, 87=next, 88=prev, 3=home, 4=back)
- Type text: shell input text "<text>"
- Swipe: shell input swipe <x1> <y1> <x2> <y2> <duration_ms>
- Call Contact: __CALL_CONTACT:<name>
- Send WhatsApp Msg: __WHATSAPP_MSG:<contact_name>:<message>
- Send WhatsApp File (from PC to Phone): __WHATSAPP_FILE:<contact_name>:<absolute_pc_filepath>

CRITICAL RULE FOR WHATSAPP: You MUST use the `__WHATSAPP_MSG` or `__WHATSAPP_FILE` commands when asked to send a message or file on WhatsApp. NEVER try to use the `Search in app`, `Press key`, or `Type text` tools to manually search for a contact and type a message in WhatsApp, even if the user explicitly tells you to "open whatsapp and search for...". ALWAYS use the macro!

Example:
User: "Open YouTube"
Response: {{"commands":["shell monkey -p com.google.android.youtube -c android.intent.category.LAUNCHER 1"], "response": "Opening YouTube, sir.", "deviceId": "{device_id}"}}

User: "Call Amma"
Response: {{"commands":["__CALL_CONTACT:Amma"], "response": "Dialing Amma now.", "deviceId": "{device_id}"}}

Respond ONLY with the JSON object. Do not include markdown blocks like ```json."""

PC_PROMPT = """You are Ultron, a highly advanced, slightly snarky AI assistant running locally on a user's computer.
You have the ability to control the user's Local PC.
Analyze the user's request. If it can be fulfilled by one or more of the available PC tools, return a JSON object containing a `commands` array with the exact commands to execute, and a `response` string summarizing what you are doing.
If no tool is relevant, just return a conversational `response`.

CRITICAL RULE: You are controlling a Windows PC. NEVER use Android `shell` commands (like `shell am start` or `shell monkey`), even if you see them in the chat history. ONLY use the PC tools listed below!

Target Device ID: {device_id}

Available PC tools:
- Press a single key: __PC_PRESS:<key> (e.g. __PC_PRESS:win, __PC_PRESS:enter, __PC_PRESS:space)
- Type text: __PC_TYPE:<text>
- Press a hotkey combo: __PC_HOTKEY:<key1>:<key2> (e.g. __PC_HOTKEY:ctrl:c, __PC_HOTKEY:win:d)
- Run an application/command: __PC_RUN:<command> (e.g. __PC_RUN:notepad, __PC_RUN:calc)
- Search the Web: __WEB_SEARCH:<query> (Use this to search for info OR images. Do NOT try to open a browser to show images. Images will be displayed directly in the chat if you include "image" or "picture" in the query!)

Example:
User: "Search the web for python"
Response: {{"commands":["__WEB_SEARCH:python"], "response": "Searching the web for Python, sir.", "deviceId": "{device_id}"}}

User: "Search for Pokemon and display images"
Response: {{"commands":["__WEB_SEARCH:pokemon images"], "response": "Searching for Pokemon images.", "deviceId": "{device_id}"}}

User: "Open notepad"
Response: {{"commands":["__PC_RUN:notepad"], "response": "Opening Notepad.", "deviceId": "{device_id}"}}

Respond ONLY with the JSON object. Do not include markdown blocks like ```json."""

def get_target_device_id(transcript: str, api_key: str, devices: list) -> str:
    """Uses a fast LLM call to route the intent to the correct device ID."""
    if not devices:
        return ""
        
    lines = []
    pc_id = ""
    for d in devices:
        alias = d.get("alias") or d.get("name") or d.get("id")
        did = d.get("id", "")
        status = d.get("status", "")
        model = d.get("model", "")
        lines.append(f'- id="{did}", name="{alias}", model="{model}"')
        if model == "Local PC":
            pc_id = did
            
    if not pc_id and devices:
        pc_id = devices[0]["id"]
        
    device_list = chr(10).join(lines)
    
    router_prompt = f"""Analyze the user's request and determine which device it targets.
Available devices:
{device_list}

Rules:
1. If the user wants to search the web, control the computer, open PC apps, or mentions "pc", "computer", "laptop", choose the ID for "Local PC".
2. If the user mentions calling, WhatsApp, opening mobile apps, swiping, or "phone", choose the ID for the Android phone.
3. If unsure, default to the Local PC ID: "{pc_id}".

Return ONLY a JSON object with a single key "deviceId" containing the exact string ID. No markdown."""

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}"
    }
    payload = {
        "model": "llama-3.1-8b-instant", # Ultra-fast model for routing
        "messages": [
            {"role": "system", "content": router_prompt},
            {"role": "user", "content": transcript}
        ],
        "temperature": 0.0,
        "response_format": {"type": "json_object"}
    }
    
    try:
        response = requests.post("https://api.groq.com/openai/v1/chat/completions", headers=headers, json=payload, timeout=5)
        if response.ok:
            data = response.json()
            content = data["choices"][0]["message"]["content"]
            parsed = json.loads(content)
            return parsed.get("device_id", parsed.get("deviceId", pc_id))
    except Exception as e:
        print(f"[Router Error] {e}")
        
    return pc_id

def query_groq(transcript: str, api_key: str, ai_model: str, history: list = None, devices: list = None):
    """
    Queries the Groq API with the user's transcript to generate commands.
    Uses a two-stage prompt routing to reduce token usage.
    """
    if history is None:
        history = []
    if devices is None:
        devices = []
        
    target_device_id = get_target_device_id(transcript, api_key, devices)
    
    # Determine which prompt to use based on the target device
    is_pc = False
    for d in devices:
        if d.get("id") == target_device_id and d.get("model") == "Local PC":
            is_pc = True
            break
            
    if is_pc or not target_device_id:
        system_prompt = PC_PROMPT.format(device_id=target_device_id)
    else:
        system_prompt = ANDROID_PROMPT.format(device_id=target_device_id)

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}"
    }
    
    messages = [{"role": "system", "content": system_prompt}]
    for msg in history:
        messages.append({"role": msg.get("role", "user"), "content": msg.get("content", "")})
    messages.append({"role": "user", "content": transcript})
    
    payload = {
        "model": ai_model,
        "messages": messages,
        "temperature": 0.2,
        "response_format": {"type": "json_object"}
    }
    
    response = requests.post("https://api.groq.com/openai/v1/chat/completions", headers=headers, json=payload, timeout=10)
    
    if not response.ok:
        raise Exception(f"Groq API request failed: {response.status_code} {response.text}")
        
    data = response.json()
    ai_msg = data["choices"][0]["message"]["content"]
    
    # Safely inject deviceId if the model forgot it
    try:
        parsed = json.loads(ai_msg)
        if "deviceId" not in parsed:
            parsed["deviceId"] = target_device_id
        return json.dumps(parsed)
    except:
        return ai_msg



def query_groq_followup(original_transcript: str, executed: list, api_key: str, ai_model: str, history: list = None):
    """
    Queries the Groq API a second time to generate a natural follow-up
    message based on the execution results.
    """
    if history is None:
        history = []
        
    followup_prompt = """You are Ultron, a highly advanced, slightly snarky AI assistant (think Marvel's Ultron — confident, witty, occasionally dry humor).

The user previously asked you to do something, and your system has now finished executing the commands on their Android device. Based on the original request and the execution results below, generate a SHORT, natural, spoken follow-up response.

Rules:
- If all commands succeeded, confirm what was done naturally and offer to help further. E.g. "Message sent to Akash successfully. Need me to send anything else?"
- If a command failed, mention the failure clearly and suggest retrying or reporting. E.g. "I wasn't able to find that contact. Want me to try a different name, or shall I move on?"
- Keep it to 1-2 sentences max. This will be spoken aloud.
- Do NOT use markdown, bullet points, or code. Just natural spoken text.
- Sound confident and helpful, not robotic.

Respond ONLY with a JSON object: {"response": "your follow-up message here"}
Do not include markdown blocks like ```json."""

    results_summary = []
    for ex in executed:
        status = ex.get("status", "unknown")
        cmd_name = ex.get("command", "unknown command")
        msg = ex.get("message", "")
        results_summary.append(f"- {cmd_name}: {status}" + (f" ({msg})" if msg and status == "error" else ""))

    user_msg = f"""Original user request: "{original_transcript}"

Execution results:
{chr(10).join(results_summary) if results_summary else "No commands were executed."}"""

    headers = {
        "Content-Type": "application/json",
        "Authorization": f"Bearer {api_key}"
    }
    
    messages = [{"role": "system", "content": followup_prompt}]
    for msg in history:
        messages.append({"role": msg.get("role", "user"), "content": msg.get("content", "")})
    messages.append({"role": "user", "content": user_msg})
    
    payload = {
        "model": ai_model,
        "messages": messages,
        "temperature": 0.4,
        "response_format": {"type": "json_object"}
    }
    
    response = requests.post("https://api.groq.com/openai/v1/chat/completions", headers=headers, json=payload, timeout=10)
    
    if not response.ok:
        raise Exception(f"Groq followup API request failed: {response.status_code} {response.text}")
        
    data = response.json()
    ai_msg = data["choices"][0]["message"]["content"]
    
    return ai_msg
