"""Helper functions for sending notification emails."""

from __future__ import annotations

import os
import smtplib
from email.message import EmailMessage
from typing import Optional


def send_failure_email(subject: str, body: str) -> None:
    """Send a failure notification email using SMTP.

    SMTP configuration is taken from environment variables:
    ``SMTP_HOST``, ``SMTP_PORT``, ``SMTP_USERNAME``, ``SMTP_PASSWORD``,
    ``ALERT_EMAIL_FROM`` and ``ALERT_EMAIL_TO``.
    If the required configuration is missing, the function silently returns.
    """

    smtp_host = os.getenv("SMTP_HOST")
    to_addr = os.getenv("ALERT_EMAIL_TO")
    if not smtp_host or not to_addr:
        return

    smtp_port = int(os.getenv("SMTP_PORT", "587"))
    smtp_user = os.getenv("SMTP_USERNAME")
    smtp_pass = os.getenv("SMTP_PASSWORD")
    from_addr = os.getenv("ALERT_EMAIL_FROM", smtp_user)

    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = from_addr or ""
    msg["To"] = to_addr
    msg.set_content(body)

    try:
        with smtplib.SMTP(smtp_host, smtp_port) as server:
            server.starttls()
            if smtp_user and smtp_pass:
                server.login(smtp_user, smtp_pass)
            server.send_message(msg)
    except Exception as exc:
        print(f"[Email] failed to send notification: {exc}")
