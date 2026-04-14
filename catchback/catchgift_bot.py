"""
catchgift_bot.py
================
GRP 2A — Gift & FOC Delivery Evidence Bot
Captures photos + debtor codes sent in Telegram group.
Logs to gift_log.json and Google Sheets.

Setup:
  1. Create bot via @BotFather → get TOKEN
  2. Add bot to your Telegram group as admin
  3. Fill in config below
  4. Run: python catchgift_bot.py
"""

import os
import json
import logging
import re
from datetime import datetime
from pathlib import Path
from telegram import Update
from telegram.ext import (
    Application, MessageHandler, filters,
    ContextTypes, ConversationHandler
)

# ─────────────────────────────────────────
#  CONFIG — fill these in
# ─────────────────────────────────────────
BOT_TOKEN       = "YOUR_BOT_TOKEN_HERE"          # from @BotFather
ALLOWED_GROUP_ID = -1001234567890                # your Telegram group chat ID (negative number)
GIFT_LOG_PATH   = Path("gift_log.json")          # output JSON (same folder as process_data.py)
PHOTO_DIR       = Path("gift_photos")            # folder to save downloaded photos

# Google Sheets config (leave blank to skip Sheets logging)
GSHEET_ENABLED         = False                   # set True after completing Google setup
GSHEET_CREDENTIALS_FILE = "gsheet_credentials.json"  # service account JSON
GSHEET_SPREADSHEET_NAME = "GRP 2A Gift Log"
GSHEET_WORKSHEET_NAME   = "Submissions"

# Campaign code prefixes → auto-detect type
CAMPAIGN_PREFIXES = {
    "BG": "Birthday Gift",
    "FOC": "FOC Sample",
    "FES": "Festive Gift",
    "PROMO": "Brand Promo",
}

# Pending photo store: tracks photos waiting for a debtor code reply
# Key: (chat_id, message_id)  Value: {agent, timestamp, file_id}
pending_photos: dict = {}

# ─────────────────────────────────────────
#  LOGGING
# ─────────────────────────────────────────
logging.basicConfig(
    format="%(asctime)s [%(levelname)s] %(name)s: %(message)s",
    level=logging.INFO,
    handlers=[
        logging.StreamHandler(),
        logging.FileHandler("catchgift_bot.log", encoding="utf-8"),
    ]
)
logger = logging.getLogger("catchgift_bot")


# ─────────────────────────────────────────
#  HELPERS
# ─────────────────────────────────────────

def load_gift_log() -> list:
    if GIFT_LOG_PATH.exists():
        with open(GIFT_LOG_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    return []


def save_gift_log(log: list):
    with open(GIFT_LOG_PATH, "w", encoding="utf-8") as f:
        json.dump(log, f, ensure_ascii=False, indent=2)
    logger.info(f"gift_log.json updated ({len(log)} entries)")


def detect_campaign(debtor_code: str) -> str:
    code_upper = debtor_code.upper()
    for prefix, campaign in CAMPAIGN_PREFIXES.items():
        if code_upper.startswith(prefix):
            return campaign
    return "Unknown"


def extract_debtor_code(text: str) -> str | None:
    """Extract debtor code from message text. Accepts formats: BG001, FOC-123, PROMO_456, etc."""
    if not text:
        return None
    # Match word that looks like a debtor code: letters followed by digits (with optional separator)
    match = re.search(r'\b([A-Za-z]{1,6}[-_]?\d{2,6})\b', text.strip())
    if match:
        return match.group(1).upper()
    return None


def get_agent_name(user) -> str:
    if user.username:
        return f"@{user.username}"
    full = f"{user.first_name or ''} {user.last_name or ''}".strip()
    return full or f"UserID_{user.id}"


async def download_photo(context: ContextTypes.DEFAULT_TYPE, file_id: str, debtor_code: str, timestamp: str) -> str | None:
    """Download photo from Telegram and save locally. Returns relative path."""
    try:
        PHOTO_DIR.mkdir(exist_ok=True)
        safe_ts = timestamp.replace(":", "").replace(" ", "_")
        filename = f"{debtor_code}_{safe_ts}.jpg"
        filepath = PHOTO_DIR / filename
        file = await context.bot.get_file(file_id)
        await file.download_to_drive(str(filepath))
        logger.info(f"Photo saved: {filepath}")
        return str(filepath)
    except Exception as e:
        logger.error(f"Failed to download photo: {e}")
        return None


def log_to_gsheet(entry: dict):
    """Append one entry to Google Sheet."""
    if not GSHEET_ENABLED:
        return
    try:
        import gspread
        from google.oauth2.service_account import Credentials
        scopes = ["https://www.googleapis.com/auth/spreadsheets"]
        creds = Credentials.from_service_account_file(GSHEET_CREDENTIALS_FILE, scopes=scopes)
        gc = gspread.authorize(creds)
        sh = gc.open(GSHEET_SPREADSHEET_NAME)
        ws = sh.worksheet(GSHEET_WORKSHEET_NAME)
        # Ensure header row exists
        if ws.row_count == 0 or ws.cell(1, 1).value != "Timestamp":
            ws.append_row(["Timestamp", "Agent", "Debtor Code", "Campaign", "Photo Path", "Remark", "Month"])
        ws.append_row([
            entry["timestamp"],
            entry["agent"],
            entry["debtor_code"],
            entry["campaign"],
            entry.get("photo_path", ""),
            entry.get("remark", ""),
            entry["month"],
        ])
        logger.info(f"Logged to Google Sheet: {entry['debtor_code']}")
    except Exception as e:
        logger.error(f"Google Sheet log failed: {e}")


def build_entry(agent: str, debtor_code: str, photo_path: str | None, remark: str = "") -> dict:
    now = datetime.now()
    return {
        "timestamp": now.strftime("%Y-%m-%d %H:%M:%S"),
        "month": now.strftime("%b %y"),       # e.g. "Apr 26" — matches dashboard format
        "agent": agent,
        "debtor_code": debtor_code,
        "campaign": detect_campaign(debtor_code),
        "photo_path": photo_path or "",
        "remark": remark,
        "audit_status": "Pending",           # management sets to "Approved" / "Rejected"
    }


# ─────────────────────────────────────────
#  HANDLERS
# ─────────────────────────────────────────

async def handle_photo_with_code(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Photo sent with a debtor code in the caption."""
    msg = update.message
    if not msg or msg.chat_id != ALLOWED_GROUP_ID:
        return

    agent = get_agent_name(msg.from_user)
    caption = msg.caption or ""
    debtor_code = extract_debtor_code(caption)

    if not debtor_code:
        # Photo has no code — store pending, ask for code
        file_id = msg.photo[-1].file_id   # largest size
        pending_photos[(msg.chat_id, msg.message_id)] = {
            "agent": agent,
            "timestamp": datetime.now().strftime("%Y-%m-%d %H:%M:%S"),
            "file_id": file_id,
        }
        await msg.reply_text(
            f"📸 Photo received, {agent}!\n"
            f"Please reply to this message with the debtor code (e.g. BG001, FOC123)."
        )
        logger.info(f"Photo without code from {agent} — stored pending (msg_id={msg.message_id})")
        return

    # Has code — process immediately
    photo_path = await download_photo(context, msg.photo[-1].file_id, debtor_code, datetime.now().strftime("%Y-%m-%d %H:%M:%S"))
    entry = build_entry(agent, debtor_code, photo_path, remark=caption)

    log = load_gift_log()
    log.append(entry)
    save_gift_log(log)
    log_to_gsheet(entry)

    await msg.reply_text(
        f"✅ Logged!\n"
        f"👤 Agent: {agent}\n"
        f"🏷️ Code: {debtor_code}\n"
        f"🎯 Campaign: {entry['campaign']}\n"
        f"🕐 {entry['timestamp']}"
    )
    logger.info(f"Logged: {agent} | {debtor_code} | {entry['campaign']}")


async def handle_reply_with_code(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Agent replies to bot's 'please send code' message with the debtor code."""
    msg = update.message
    if not msg or msg.chat_id != ALLOWED_GROUP_ID:
        return
    if not msg.reply_to_message:
        return

    # Check if this is a reply to a photo message we're tracking
    # Bot's request message is a reply_to the original photo — walk back to find original photo msg_id
    replied_to = msg.reply_to_message

    # Case 1: Agent replies directly to the photo message
    pending_key = (msg.chat_id, replied_to.message_id)

    # Case 2: Agent replies to the bot's prompt (which itself replied to the photo)
    if pending_key not in pending_photos and replied_to.reply_to_message:
        pending_key = (msg.chat_id, replied_to.reply_to_message.message_id)

    if pending_key not in pending_photos:
        return   # not a pending photo reply — ignore

    debtor_code = extract_debtor_code(msg.text or "")
    if not debtor_code:
        await msg.reply_text("❌ Couldn't read that code. Please reply with the debtor code only (e.g. BG001).")
        return

    pending = pending_photos.pop(pending_key)
    agent = pending["agent"]
    photo_path = await download_photo(context, pending["file_id"], debtor_code, pending["timestamp"])
    entry = build_entry(agent, debtor_code, photo_path)
    entry["timestamp"] = pending["timestamp"]   # preserve original photo timestamp

    log = load_gift_log()
    log.append(entry)
    save_gift_log(log)
    log_to_gsheet(entry)

    await msg.reply_text(
        f"✅ Logged!\n"
        f"👤 Agent: {agent}\n"
        f"🏷️ Code: {debtor_code}\n"
        f"🎯 Campaign: {entry['campaign']}\n"
        f"🕐 {entry['timestamp']}"
    )
    logger.info(f"Logged (via reply): {agent} | {debtor_code} | {entry['campaign']}")


async def handle_text_only(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Standalone text with a code (no photo) — also handle replies with code."""
    msg = update.message
    if not msg or msg.chat_id != ALLOWED_GROUP_ID:
        return

    # Only process if it looks like a debtor code reply
    if msg.reply_to_message:
        await handle_reply_with_code(update, context)


# ─────────────────────────────────────────
#  MAIN
# ─────────────────────────────────────────

def main():
    logger.info("catchgift_bot starting...")

    if BOT_TOKEN == "YOUR_BOT_TOKEN_HERE":
        logger.error("❌ BOT_TOKEN not set! Edit catchgift_bot.py and fill in your token.")
        return

    app = Application.builder().token(BOT_TOKEN).build()

    # Handler: any message with a photo (caption or not)
    app.add_handler(MessageHandler(filters.PHOTO & filters.Chat(ALLOWED_GROUP_ID), handle_photo_with_code))

    # Handler: text replies (for code after photo)
    app.add_handler(MessageHandler(filters.TEXT & filters.REPLY & filters.Chat(ALLOWED_GROUP_ID), handle_text_only))

    logger.info(f"Bot running. Watching group ID: {ALLOWED_GROUP_ID}")
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == "__main__":
    main()
