from pydantic import BaseModel
from typing import Optional, List

class AndroidRequest(BaseModel):
    type: str = "action"
    ip: Optional[str] = None
    port: Optional[str] = None
    code: Optional[str] = None
    target: Optional[str] = None
    action: Optional[str] = None
    deviceId: Optional[str] = None
    alias: Optional[str] = None

class VoiceRequest(BaseModel):
    transcript: str
    model: Optional[str] = None
    apiKey: Optional[str] = None
    history: Optional[List[dict]] = []
    devices: Optional[List[dict]] = []

class ExecuteRequest(BaseModel):
    commands: List[str]
    model: Optional[str] = None
    apiKey: Optional[str] = None
    history: Optional[List[dict]] = []
    deviceId: Optional[str] = None

class FollowupRequest(BaseModel):
    originalTranscript: str
    executed: List[dict]
    model: Optional[str] = None
    apiKey: Optional[str] = None
    history: Optional[List[dict]] = []
