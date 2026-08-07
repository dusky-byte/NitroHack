import os
import time
import socket
from typing import Dict, Any

try:
    import pyautogui
    # Configure pyautogui for safety
    pyautogui.FAILSAFE = True
    pyautogui.PAUSE = 0.5
except ImportError:
    pyautogui = None

try:
    # pyrefly: ignore [missing-import]
    from duckduckgo_search import DDGS
except ImportError:
    DDGS = None


def get_local_pc_id() -> str:
    """Returns the ID of the PC running the backend."""
    return f"local_pc_{socket.gethostname()}"


def execute_pc_commands(commands: list) -> list:
    """Execute PC automation and Web Search commands natively."""
    results = []
    
    for cmd in commands:
        try:
            if cmd.startswith("__WEB_SEARCH:"):
                query = cmd.split(":", 1)[1].strip()
                results.append(_run_web_search(query))
                
            elif cmd.startswith("__PC_PRESS:"):
                key = cmd.split(":", 1)[1].strip()
                if pyautogui:
                    pyautogui.press(key)
                    results.append({"command": f"PC Press '{key}'", "status": "success", "message": ""})
                else:
                    results.append({"command": "PC Action", "status": "error", "message": "pyautogui not installed"})
                    
            elif cmd.startswith("__PC_TYPE:"):
                text = cmd.split(":", 1)[1].strip()
                if pyautogui:
                    pyautogui.write(text, interval=0.05)
                    results.append({"command": f"PC Type '{text}'", "status": "success", "message": ""})
                else:
                    results.append({"command": "PC Action", "status": "error", "message": "pyautogui not installed"})
                    
            elif cmd.startswith("__PC_HOTKEY:"):
                keys = cmd.split(":", 1)[1].strip().split(":")
                if pyautogui:
                    pyautogui.hotkey(*keys)
                    results.append({"command": f"PC Hotkey '{keys}'", "status": "success", "message": ""})
                else:
                    results.append({"command": "PC Action", "status": "error", "message": "pyautogui not installed"})
                    
            elif cmd.startswith("__PC_RUN:"):
                app_cmd = cmd.split(":", 1)[1].strip()
                # Use os.system to spawn in background without blocking
                os.system(f"start {app_cmd}")
                results.append({"command": f"PC Run '{app_cmd}'", "status": "success", "message": ""})
                
            else:
                results.append({"command": cmd, "status": "error", "message": "Unknown PC Command"})
                
        except Exception as e:
            results.append({"command": cmd, "status": "error", "message": str(e)})

    return results


def _run_web_search(query: str) -> Dict[str, Any]:
    """Execute a web search using duckduckgo-search and return a summary."""
    if not DDGS:
        return {"command": f"Web Search: {query}", "status": "error", "message": "duckduckgo-search not installed"}
    
    try:
        combined_text = ""
        wants_images = any(word in query.lower() for word in ['image', 'images', 'pic', 'pics', 'picture', 'pictures'])
        
        if wants_images:
            try:
                images = DDGS().images(query, max_results=3)
                if images:
                    combined_text += "\n\n".join([f"![image]({img['image']})" for img in images]) + "\n\n"
            except Exception as e:
                print(f"DDGS Image failed: {e}. Falling back to Wikipedia...")
                try:
                    import urllib.request
                    import json
                    # Search wikipedia for the query title
                    search_url = f"https://en.wikipedia.org/w/api.php?action=query&list=search&srsearch={urllib.parse.quote(query)}&utf8=&format=json"
                    req = urllib.request.Request(search_url, headers={'User-Agent': 'Mozilla/5.0'})
                    with urllib.request.urlopen(req, timeout=5) as response:
                        search_data = json.loads(response.read().decode())
                        if search_data.get('query', {}).get('search'):
                            title = search_data['query']['search'][0]['title']
                            img_url = f"https://en.wikipedia.org/w/api.php?action=query&titles={urllib.parse.quote(title)}&prop=pageimages&format=json&pithumbsize=500"
                            req2 = urllib.request.Request(img_url, headers={'User-Agent': 'Mozilla/5.0'})
                            with urllib.request.urlopen(req2, timeout=5) as resp2:
                                img_data = json.loads(resp2.read().decode())
                                pages = img_data.get('query', {}).get('pages', {})
                                for page_id, page_info in pages.items():
                                    if 'thumbnail' in page_info:
                                        combined_text += f"![image]({page_info['thumbnail']['source']})\n\n"
                                        break
                except Exception as ex:
                    print(f"Wiki image fallback failed: {ex}")
                
        try:
            results = DDGS().text(query, max_results=3)
            if results:
                combined_text += "\n\n".join([f"**{r['title']}**\n{r['body']}" for r in results])
        except Exception as e:
            print(f"DDGS Text failed: {e}")
            
        if not combined_text.strip() or (wants_images and not combined_text.strip()):
            # Fallback to Wikipedia OpenSearch API for text
            try:
                import urllib.request
                import json
                search_url = f"https://en.wikipedia.org/w/api.php?action=opensearch&search={urllib.parse.quote(query)}&limit=3&namespace=0&format=json"
                req = urllib.request.Request(search_url, headers={'User-Agent': 'Mozilla/5.0'})
                with urllib.request.urlopen(req, timeout=5) as resp:
                    data = json.loads(resp.read().decode('utf-8'))
                    if len(data) >= 3 and data[1]:
                        titles = data[1]
                        descriptions = data[2]
                        for i in range(len(titles)):
                            if descriptions[i]:
                                combined_text += f"\n\n**{titles[i]}**\n{descriptions[i]}"
            except Exception as ex:
                print(f"Wiki text fallback failed: {ex}")

        if not combined_text.strip():
            return {"command": f"Web Search: {query}", "status": "error", "message": "No results found."}
        
        # We return the payload as `searchResult` so the frontend can catch it and show a popup
        return {
            "command": f"Web Search: {query}", 
            "status": "success", 
            "message": "", 
            "searchResult": combined_text
        }
    except Exception as e:
        return {"command": f"Web Search: {query}", "status": "error", "message": str(e)}
