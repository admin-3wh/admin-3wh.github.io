# routes/alerts.py

from fastapi import APIRouter
from models.alerts import Alert, CreateAlertRequest

router = APIRouter()
alerts_db = []  # Temporary in-memory store

@router.post("/")
def create_alert(alert: CreateAlertRequest):
    new_alert = Alert(id=len(alerts_db) + 1, keyword=alert.keyword, email=alert.email)
    alerts_db.append(new_alert)
    return {"message": "Alert created", "alert": new_alert}

@router.get("/")
def list_alerts():
    return alerts_db
