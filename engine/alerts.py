"""Alerts: recorded in the database (shown in the app's Sources tab) and pushed
out through whichever channels are configured in the environment:

  ALERT_WEBHOOK   URL that receives a plain-text POST (ntfy.sh topic, Slack/Discord-compatible relay...)
  ALERT_EMAIL_TO  + SMTP_HOST, SMTP_PORT, SMTP_USER, SMTP_PASS, ALERT_EMAIL_FROM
"""
from __future__ import annotations

import logging
import os
import smtplib
from email.message import EmailMessage

log = logging.getLogger("alerts")


def record(con, source: str, kind: str, message: str) -> bool:
    """Open an alert unless the same one is already open. True if newly opened."""
    if con.execute("SELECT 1 FROM alerts WHERE source=? AND kind=? AND resolved_at IS NULL", (source, kind)).fetchone():
        con.execute("UPDATE alerts SET message=? WHERE source=? AND kind=? AND resolved_at IS NULL", (message, source, kind))
        return False
    con.execute("INSERT INTO alerts (source,kind,message) VALUES (?,?,?)", (source, kind, message))
    return True


def resolve(con, source: str, kinds: list[str]) -> None:
    con.execute(f"UPDATE alerts SET resolved_at=datetime('now') WHERE source=? AND resolved_at IS NULL "
                f"AND kind IN ({','.join('?' * len(kinds))})", (source, *kinds))


def send(subject: str, body: str) -> list[str]:
    sent = []
    hook = os.environ.get("ALERT_WEBHOOK")
    if hook:
        try:
            import requests
            requests.post(hook, data=f"{subject}\n\n{body}".encode(), headers={"Title": subject}, timeout=20).raise_for_status()
            sent.append("webhook")
        except Exception as e:  # noqa: BLE001
            log.error("alert webhook failed: %s", e)
    to = os.environ.get("ALERT_EMAIL_TO")
    if to and os.environ.get("SMTP_HOST"):
        try:
            m = EmailMessage()
            m["Subject"], m["To"] = subject, to
            m["From"] = os.environ.get("ALERT_EMAIL_FROM") or os.environ.get("SMTP_USER") or to
            m.set_content(body)
            with smtplib.SMTP(os.environ["SMTP_HOST"], int(os.environ.get("SMTP_PORT", 587)), timeout=30) as s:
                s.starttls()
                if os.environ.get("SMTP_USER"):
                    s.login(os.environ["SMTP_USER"], os.environ.get("SMTP_PASS", ""))
                s.send_message(m)
            sent.append("email")
        except Exception as e:  # noqa: BLE001
            log.error("alert email failed: %s", e)
    if not sent:
        log.warning("ALERT (no channel configured, recorded in app only): %s\n%s", subject, body)
    return sent
