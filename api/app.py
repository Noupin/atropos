from __future__ import annotations
import os, json, re, time, threading, hmac, hashlib, base64, secrets, logging, smtplib
from email.message import EmailMessage
from email.utils import formataddr
from pathlib import Path
from flask import Flask, request, jsonify

from api.social_metrics import social_metrics_bp

LOGGER = logging.getLogger(__name__)

LOCAL_STORAGE_ROOT = Path(__file__).resolve().parent / ".localdata"


def _prepare_storage_path(
    candidate: Path,
    *,
    default_contents: str,
    allow_fallback: bool,
) -> Path:
    """Ensure the storage file exists, optionally falling back to a local path."""

    def _initialize(target: Path) -> Path:
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists():
            target.write_text(default_contents, encoding="utf-8")
        return target

    try:
        return _initialize(candidate)
    except OSError as error:
        if not allow_fallback:
            raise
        fallback_dir = LOCAL_STORAGE_ROOT
        fallback_dir.mkdir(parents=True, exist_ok=True)
        fallback_path = fallback_dir / candidate.name
        LOGGER.warning(
            "Storage path %s is not writable (%s); using fallback %s",
            candidate,
            error,
            fallback_path,
        )
        return _initialize(fallback_path)


def _resolve_storage(
    env_var: str,
    default_filename: str,
    *,
    default_contents: str,
) -> Path:
    override = os.environ.get(env_var)
    if override:
        return _prepare_storage_path(Path(override), default_contents=default_contents, allow_fallback=False)

    candidate = Path("/data") / default_filename
    return _prepare_storage_path(
        candidate,
        default_contents=default_contents,
        allow_fallback=True,
    )


# ---------- config / storage ----------
SUBSCRIBERS = _resolve_storage("SUBSCRIBERS_FILE", "subscribers.json", default_contents="[]")
UNSUB_TOKENS = _resolve_storage("UNSUB_TOKENS_FILE", "unsub_tokens.json", default_contents="{}")
BASE_URL      = os.environ.get("PUBLIC_BASE_URL", "https://atropos-video.com")

SMTP_HOST     = os.environ.get("SMTP_HOST", "")
SMTP_PORT     = int(os.environ.get("SMTP_PORT", "587"))           # 587 STARTTLS (recommended)
SMTP_USER     = os.environ.get("SMTP_USER", "")                   # e.g. hello@atropos-video.com
SMTP_PASS     = os.environ.get("SMTP_PASS", "")                   # mailbox password / app password
SMTP_FROM     = os.environ.get("SMTP_FROM", SMTP_USER or "no-reply@atropos-video.com")
SMTP_USE_TLS  = os.environ.get("SMTP_USE_TLS", "true").lower() in ("1","true","yes")

# simple in-memory rate limit (per-IP)
WINDOW        = int(os.environ.get("RATE_WINDOW_SECONDS", "60"))
MAX_REQ       = int(os.environ.get("RATE_MAX_REQUESTS", "10"))

EMAIL_RE = re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")

BUCKET: dict[str, list[float]] = {}
LOCK = threading.Lock()

def ratelimit(ip: str) -> bool:
    now = time.time()
    with LOCK:
        times = [t for t in BUCKET.get(ip, []) if now - t < WINDOW]
        times.append(now)
        BUCKET[ip] = times
        return len(times) <= MAX_REQ

def load_subs() -> list[str]:
    try:
        return json.loads(SUBSCRIBERS.read_text(encoding="utf-8"))
    except Exception:
        return []

def save_subs(subs: list[str]) -> None:
    SUBSCRIBERS.write_text(json.dumps(sorted(set(subs)), ensure_ascii=False, indent=2), encoding="utf-8")

def load_tokens() -> dict[str, str]:
    try:
        return json.loads(UNSUB_TOKENS.read_text(encoding="utf-8"))
    except Exception:
        return {}

def save_tokens(tokens: dict[str, str]) -> None:
    UNSUB_TOKENS.write_text(json.dumps(tokens, ensure_ascii=False, indent=2), encoding="utf-8")

def gen_unsub_token(email: str) -> str:
    # random, URL-safe token per email; store mapping token -> email
    return base64.urlsafe_b64encode(secrets.token_bytes(24)).rstrip(b"=").decode("ascii")

def send_welcome_email(to_email: str, unsub_link: str) -> None:
    if not (SMTP_HOST and SMTP_FROM):
        app.logger.warning("SMTP not configured (missing SMTP_HOST/SMTP_FROM) — skipping email send.")
        return

    subject = "Welcome to Atropos — you're on the list"
    from_addr = formataddr(("Atropos", os.environ["SMTP_FROM"]))

    # ---- Build message (text + HTML) ----
    msg = EmailMessage()
    msg["Subject"] = subject
    msg["From"] = from_addr
    msg["To"] = to_email

    # List-Unsubscribe helps deliverability + shows native Unsubscribe UI
    # (include both a URL and a mailto form)
    msg["List-Unsubscribe"] = f"<{unsub_link}>, <mailto:{SMTP_FROM}?subject=unsubscribe>"
    msg["List-Unsubscribe-Post"] = "List-Unsubscribe=One-Click"

    # Plain-text fallback (must exist)
    text_body = f"""You're in.

We'll email you when we launch. Until then, enjoy the calm before the cut.

Unsubscribe: {unsub_link}
— Atropos
"""
    msg.set_content(text_body)

    # HTML primary (inline CSS, table layout)
    html_body = f"""\
<!doctype html>
<html>
  <head>
    <meta charset="utf-8">
    <meta name="x-apple-disable-message-reformatting">
    <meta name="color-scheme" content="light only">
    <meta name="supported-color-schemes" content="light">
  </head>
  <body style="margin:0;padding:0;background:#eeece8;">
    <table role="presentation" cellpadding="0" cellspacing="0" width="100%" style="background:linear-gradient(180deg,#f6f4f1 0%,#e8e5df 100%);">
      <tr>
        <td align="center" style="padding:32px 14px;">
          <table role="presentation" cellpadding="0" cellspacing="0" width="560" style="background:#ffffff; border:1px solid #e7e3de; border-radius:14px; box-shadow:0 10px 30px rgba(20,20,20,.08); overflow:hidden;">
            <tr>
              <td style="padding:28px 24px 18px 24px; text-align:center;">
                <!-- “marble crest” -->
                <div style="width:64px;height:64px;margin:0 auto 8px auto;border-radius:12px;
                            background:radial-gradient(56% 56% at 44% 42%, #f2f0ec 0%, #e9e6e1 55%, #dcd9d3 100%);
                            box-shadow:inset 0 1px 0 rgba(255,255,255,.7), 0 1px 0 rgba(0,0,0,.06);"></div>
                <h1 style="margin:8px 0 2px 0;font:600 24px/1.2 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Inter,system-ui,sans-serif;color:#2d2c2a;letter-spacing:.2px;">
                  Atropos
                </h1>
                <p style="margin:0;color:#6b6a67;font:400 14px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Inter,system-ui,sans-serif;">
                  Made for you, by you.
                </p>
              </td>
            </tr>

            <!-- divider: “crevice” line -->
            <tr>
              <td>
                <div style="height:12px;background:linear-gradient(180deg,#3a3936 0%,#1e1d1b 100%);"></div>
              </td>
            </tr>

            <tr>
              <td style="padding:22px 24px 8px 24px;color:#2f2e2b;font:400 16px/1.6 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Inter,system-ui,sans-serif;">
                <p style="margin:0 0 12px 0;">You're in.</p>
                <p style="margin:0 0 12px 0;">We'll email you when we launch. Until then, enjoy the calm before the cut.</p>
              </td>
            </tr>

            <tr>
              <td style="padding:6px 24px 28px 24px;" align="center">
                <a href="{BASE_URL}" target="_blank"
                   style="display:inline-block;padding:12px 18px;border-radius:12px;
                          background:linear-gradient(180deg,#3a3936,#201f1d);color:#fff;text-decoration:none;
                          font:600 14px/1 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Inter,system-ui,sans-serif;
                          letter-spacing:.2px;box-shadow:0 10px 20px rgba(20,20,20,.25);">
                  Visit Atropos
                </a>
              </td>
            </tr>

            <tr>
              <td style="padding:14px 18px 22px 18px; background:#fbfaf8; color:#7a7874;
                         font:400 12px/1.5 -apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Inter,system-ui,sans-serif; text-align:center;">
                You received this because you joined the Atropos list.
                <br>
                <a href="{unsub_link}" style="color:#595754;text-decoration:underline;">Unsubscribe</a>
              </td>
            </tr>

          </table>
        </td>
      </tr>
    </table>
  </body>
</html>
"""
    msg.add_alternative(html_body, subtype="html")

    # ---- Send ----
    app.logger.info(f"Connecting SMTP {SMTP_HOST}:{SMTP_PORT} TLS={SMTP_USE_TLS}")
    if SMTP_USE_TLS:
        with smtplib.SMTP(SMTP_HOST, SMTP_PORT, timeout=20) as s:
            s.ehlo(); s.starttls(); s.ehlo()
            if SMTP_USER and SMTP_PASS:
                s.login(SMTP_USER, SMTP_PASS)
            s.send_message(msg)
    else:
        with smtplib.SMTP_SSL(SMTP_HOST, SMTP_PORT, timeout=20) as s:
            if SMTP_USER and SMTP_PASS:
                s.login(SMTP_USER, SMTP_PASS)
            s.send_message(msg)
    app.logger.info(f"Sent welcome email to {to_email}")

# ---------- app ----------
app = Flask(__name__)
app.register_blueprint(social_metrics_bp)

# log to stdout (visible in `docker compose logs -f atropos-video-api`)
handler = logging.StreamHandler()
handler.setFormatter(logging.Formatter("[%(asctime)s] %(levelname)s: %(message)s"))
app.logger.setLevel(logging.INFO)
app.logger.addHandler(handler)

@app.get("/health")
def health():
    return jsonify({"status": "ok"}), 200

@app.post("/subscribe")
def subscribe():
    ip = request.headers.get("X-Forwarded-For", request.remote_addr) or "?"
    app.logger.info(f"/subscribe from {ip}")
    if not ratelimit(ip):
        app.logger.warning(f"Rate limited: {ip}")
        return jsonify({"ok": False, "error": "Too many requests"}), 429

    data = request.get_json(silent=True) or {}
    email = (data.get("email") or "").strip().lower()
    if not EMAIL_RE.match(email):
        app.logger.warning(f"Invalid email: {email!r}")
        return jsonify({"ok": False, "error": "Invalid email"}), 400

    subs = load_subs()
    if email in subs:
        app.logger.info(f"Duplicate subscribe ignored for {email}")
        return jsonify({"ok": True, "duplicate": True})

    subs.append(email)
    save_subs(subs)

    # create / store unsubscribe token
    tokens = load_tokens()
    token = gen_unsub_token(email)
    tokens[token] = email
    save_tokens(tokens)

    unsub_link = f"{BASE_URL}/api/unsubscribe?token={token}"
    try:
        send_welcome_email(email, unsub_link)
    except Exception as e:
        app.logger.exception(f"Failed to send email to {email}: {e}")

    return jsonify({"ok": True})

@app.get("/unsubscribe")
def unsubscribe():
    token = (request.args.get("token") or "").strip()
    tokens = load_tokens()
    email = tokens.pop(token, None)
    if not email:
        return jsonify({"ok": False, "error": "Invalid token"}), 400
    save_tokens(tokens)

    subs = load_subs()
    if email in subs:
        subs.remove(email)
        save_subs(subs)
        app.logger.info(f"Unsubscribed {email}")
    return jsonify({"ok": True})
