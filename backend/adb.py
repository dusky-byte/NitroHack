import os
import subprocess

def get_adb_command():
    home = os.path.expanduser("~")
    local_app_data = os.path.join(home, "AppData", "Local", "Android", "Sdk", "platform-tools", "adb.exe")
    platform_tools_dir = os.path.join(os.getcwd(), "platform-tools", "adb.exe")
    local_dir = os.path.join(os.getcwd(), "adb.exe")

    if os.path.exists(local_app_data): return f'"{local_app_data}"'
    if os.path.exists(platform_tools_dir): return f'"{platform_tools_dir}"'
    if os.path.exists(local_dir): return f'"{local_dir}"'
    return "adb"

ADB_PATH = get_adb_command()

ADB_COMMANDS = {
    "media_play_pause": "shell input keyevent 85",
    "media_next":       "shell input keyevent 87",
    "media_prev":       "shell input keyevent 88",
    "volume_up":        "shell input keyevent 24",
    "volume_down":      "shell input keyevent 25",
    "volume_mute":      "shell input keyevent 164",
    "screen_power":     "shell input keyevent 26",
}

def exec_adb(cmd: str, timeout: int = 10):
    full_cmd = f"{ADB_PATH} {cmd}"
    print(f"Executing ADB: {full_cmd}")
    try:
        result = subprocess.run(full_cmd, shell=True, capture_output=True, text=True, encoding='utf-8', errors='replace', timeout=timeout)
        return result.stdout, result.stderr, result.returncode
    except subprocess.TimeoutExpired as e:
        stdout_str = e.stdout.decode('utf-8', 'replace') if isinstance(e.stdout, bytes) else (e.stdout or "")
        stderr_str = e.stderr.decode('utf-8', 'replace') if isinstance(e.stderr, bytes) else (e.stderr or "")
        return stdout_str, stderr_str, -1
