# models/alerts.py

from pydantic import BaseModel

class Alert(BaseModel):
    id: int
    keyword: str
    email: str  # or console for now

class CreateAlertRequest(BaseModel):
    keyword: str
    email: str
