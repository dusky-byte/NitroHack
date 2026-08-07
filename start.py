import subprocess
import sys
import os
import threading

def stream_output(process, prefix):
    for line in iter(process.stdout.readline, b''):
        print(f"[{prefix}] {line.decode(errors='ignore').rstrip()}")

def main():
    print("🚀 Starting Ultron Unified Server (Next.js + FastAPI)...")
    
    # Start FastAPI
    backend_cmd = [sys.executable, "-m", "uvicorn", "backend.main:app", "--port", "8000", "--reload"]
    backend_proc = subprocess.Popen(
        backend_cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        cwd=os.getcwd()
    )
    
    # Start Next.js (use shell=True on Windows for npm, must be a string)
    frontend_cmd = "npm run dev"
    frontend_proc = subprocess.Popen(
        frontend_cmd,
        stdout=subprocess.PIPE,
        stderr=subprocess.STDOUT,
        cwd=os.getcwd(),
        shell=True
    )
    
    # Run threads to stream logs
    t1 = threading.Thread(target=stream_output, args=(backend_proc, "FASTAPI"))
    t2 = threading.Thread(target=stream_output, args=(frontend_proc, "NEXTJS"))
    t1.start()
    t2.start()
    
    try:
        t1.join()
        t2.join()
    except KeyboardInterrupt:
        print("\nStopping servers...")
        backend_proc.terminate()
        frontend_proc.terminate()
        sys.exit(0)

if __name__ == "__main__":
    main()
