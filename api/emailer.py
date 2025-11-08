"""Email sending utilities for subscription flow."""

from __future__ import annotations

import base64
import secrets
import smtplib
from email.message import EmailMessage
from email.utils import formataddr
from logging import Logger

from .config import BASE_URL, SMTP_FROM, SMTP_HOST, SMTP_PASS, SMTP_PORT, SMTP_USE_TLS, SMTP_USER


def generate_unsubscribe_token() -> str:
    """Generate a random URL-safe unsubscribe token."""

    return base64.urlsafe_b64encode(secrets.token_bytes(24)).rstrip(b"=").decode("ascii")


def build_unsubscribe_link(token: str) -> str:
    """Construct the unsubscribe URL for the given token."""

    return f"{BASE_URL}/api/unsubscribe?token={token}"


def send_welcome_email(logger: Logger, to_email: str, unsub_link: str) -> None:
    """Send a welcome email with an unsubscribe link to the new subscriber."""

    if not (SMTP_HOST and SMTP_FROM):
        logger.warning("SMTP not configured (missing SMTP_HOST/SMTP_FROM) — skipping email send.")
        return

    subject = "Welcome to Atropos — you're on the list"
    from_addr = formataddr(("Atropos", SMTP_FROM))

    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = from_addr
    message["To"] = to_email
    message["List-Unsubscribe"] = f"<{unsub_link}>, <mailto:{SMTP_FROM}?subject=unsubscribe>"
    message["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"

    text_body = f"""You're in.

We'll email you when we launch. Until then, enjoy the calm before the cut.

Unsubscribe: {unsub_link}
— Atropos
"""
    message.set_content(text_body)

    html_body = f"""\
<!doctype html>
<html>
  <head>
    <meta charset=\"utf-8\">
    <meta name=\"x-apple-disable-message-reformatting\">
    <meta name=\"color-scheme\" content=\"light only\">
    <meta name=\"supported-color-schemes\" content=\"light\">
  </head>
  <body style=\"margin:0;padding:0;background:#eeece8;\">
    <table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" width=\"100%\" style=\"background:linear-gradient(180deg,#f6f4f1 0%,#e8e5df 100%);\">
      <tr>
        <td align=\"center\" style=\"padding:32px 14px;\">
          <table role=\"presentation\" cellpadding=\"0\" cellspacing=\"0\" width=\"560\" style=\"background:#ffffff; border:1px solid #e7e3de; border-radius:14px; box-shadow:0 10px 30px rgba(20,20,20,.08); overflow:hidden;\">
            <tr>
              <td style=\"padding:28px 24px 18px 24px; text-align:center;\">
                <div style=\"width:64px;height:64px;margin:0 auto 8px auto;border-radius:12px;background:radial-gradient(56% 56% at 44% 42%, #f2f0ec 0%, #e9e6e1 55%, #dcd9d3 100%);box-shadow:inset 0 1px 0 rgba(255,255,255,.7), 0 1px 0 rgba(0,0,0,.06);\"></div>
                <h1 style=\"margin:8px 0 2px 0;font:600 24px/1.2 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Inter,system-ui,sans-serif;color:#2d2c2a;letter-spacing:.2px;\">
                  Atropos
                </h1>
                <p style=\"margin:0;color:#6b6a67;font:400 14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Inter,system-ui,sans-serif;\">
                  Made for you, by you.
                </p>
              </td>
            </tr>
            <tr>
              <td>
                <div style=\"height:12px;background:linear-gradient(180deg,#3a3936 0%,#1e1d1b 100%);\"></div>
              </td>
            </tr>
            <tr>
              <td style=\"padding:22px 24px 8px 24px;color:#2f2e2b;font:400 16px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Inter,system-ui,sans-serif;\">
                <p style=\"margin:0 0 12px 0;\">You're in.</p>
                <p style=\"margin:0 0 12px 0;\">We'll email you when we launch. Until then, enjoy the calm before the cut.</p>
              </td>
            </tr>
            <tr>
              <td style=\"padding:6px 24px 28px 24px;\" align=\"center\">
                <a href=\"{BASE_URL}\" target=\"_blank\"
                   style=\"display:inline-block;padding:12px 18px;border-radius:12px;background:linear-gradient(180deg,#3a3936,#201f1d);color:#fff;text-decoration:none;font:600 14px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Inter,system-ui,sans-serif;letter-spacing:.2px;box-shadow:0 10px 20px rgba(20,20,20,.25);\">
                  Visit Atropos
                </a>
              </td>
            </tr>
            <tr>
              <td style=\"padding:14px 18px 22px 18px; background:#fbfaf8; color:#7a7874;font:400 12px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Inter,system-ui,sans-serif; text-align:center;\">
                You received this because you joined the Atropos list.<br>
                <a href=\"{unsub_link}\" style=\"color:#595754;text-decoration:underline;\">Unsubscribe</a>
              </td>
            </tr>
          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
"""
    message.add_alternative(html_body, subtype="html")

    logger.info("Connecting SMTP %s:%s TLS=%s", SMTP_HOST, SMTP_PORT, SMTP_USE_TLS)

    if SMTP_USE_TLS:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=20) as smtp:
            smtp.ehlo()
            smtp.starttls()
            smtp.ehlo()
            if SMTP_USER and SMTP_PASS:
                smtp.login(SMTP_USER, SMTP_PASS)
            smtp.send_message(message)
    else:
        with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=20) as smtp:
            if SMTP_USER and SMTP_PASS:
                smtp.login(SMTP_USER, SMTP_PASS)
            smtp.send_message(message)

    logger.info("Sent welcome email to %s", to_email)


__all__ = [
    "build_unsubscribe_link",
    "generate_unsubscribe_token",
    "send_welcome_email",
]
