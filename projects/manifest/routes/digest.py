# routes/digest.py

from fastapi import APIRouter
from pydantic import BaseModel
from typing import List
from routes.alerts import alerts_db

router = APIRouter()

class DigestQuery(BaseModel):
    text: str

class TriggeredAlert(BaseModel):
    id: int
    keyword: str
    email: str

@router.post("/")
def check_digest(payload: DigestQuery) -> List[TriggeredAlert]:
    matches = []
    for alert in alerts_db:
        if alert.keyword.lower() in payload.text.lower():
            matches.append(alert)
    return matches
