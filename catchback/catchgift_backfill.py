"""
catchgift_backfill.py
=====================
GRP 2A — Historical Gift Evidence Scraper
Scrapes past Telegram group messages within a date range from a specific topic.

Usage:
    python catchgift_backfill.py
"""

import asyncio
import json
import re
from datetime import datetime, timezone
from pathlib import Path
from telethon import TelegramClient
from telethon.tl.types import MessageMediaPhoto

# ─────────────────────────────────────────
#  CONFIG — fill these in
# ─────────────────────────────────────────
API_ID     = 35533633
API_HASH   = "1e2eebfd53ef0c4b9c6a5b163ca71f3c"
GROUP_NAME = "t.me/+3lZmmEKB0rhiNTU1"
TOPIC_ID   = 28034                      # 生日礼物 topic

GIFT_LOG_PATH = Path("gift_log.json")
PHOTO_DIR     = Path("gift_photos")

# Google Sheets (leave False to skip)
GSHEET_ENABLED          = False
GSHEET_CREDENTIALS_FILE = "gsheet_credentials.json"
GSHEET_SPREADSHEET_NAME = "GRP 2A Gift Log"
GSHEET_WORKSHEET_NAME   = "Submissions"

# Campaign prefix → type mapping
CAMPAIGN_PREFIXES = {
    "BG":    "Birthday Gift",
    "FOC":   "FOC Sample",
    "FES":   "Festive Gift",
    "PROMO": "Brand Promo",
}

# ─────────────────────────────────────────
#  HELPERS
# ─────────────────────────────────────────

def detect_campaign(code: str) -> str:
    for prefix, name in CAMPAIGN_PREFIXES.items():
        if code.upper().startswith(prefix):
            return name
    return "Birthday Gift"   # default for 生日礼物 topic


def extract_debtor_code(text: str) -> str | None:
    if not text:
        return None
    match = re.search(r'\b([A-Za-z]{1,6}[-_]?\d{2,6})\b', text.strip())
    return match.group(1).upper() if match else None


def get_display_name(sender) -> str:
    if not sender:
        return "Unknown"
    if hasattr(sender, "username") and sender.username:
        return f"@{sender.username}"
    parts = []
    if hasattr(sender, "first_name") and sender.first_name:
        parts.append(sender.first_name)
    if hasattr(sender, "last_name") and sender.last_name:
        parts.append(sender.last_name)
    return " ".join(parts) or f"UserID_{sender.id}"


def load_gift_log() -> list:
    if GIFT_LOG_PATH.exists():
        with open(GIFT_LOG_PATH, "r", encoding="utf-8") as f:
            return json.load(f)
    return []


def save_gift_log(log: list):
    with open(GIFT_LOG_PATH, "w", encoding="utf-8") as f:
        json.dump(log, f, ensure_ascii=False, indent=2)


def is_duplicate(log: list, agent: str, debtor_code: str, timestamp: str) -> bool:
    return any(
        e["agent"] == agent and e["debtor_code"] == debtor_code and e["timestamp"] == timestamp
        for e in log
    )


def build_entry(agent, debtor_code, photo_path, timestamp, remark="") -> dict:
    return {
        "timestamp":    timestamp.strftime("%Y-%m-%d %H:%M:%S"),
        "month":        timestamp.strftime("%b %y"),
        "agent":        agent,
        "debtor_code":  debtor_code,
        "campaign":     detect_campaign(debtor_code),
        "photo_path":   photo_path or "",
        "remark":       remark,
        "audit_status": "Pending",
        "source":       "backfill",
    }


def log_to_gsheet(entries: list):
    if not GSHEET_ENABLED or not entries:
        return
    try:
        import gspread
        from google.oauth2.service_account import Credentials
        creds = Credentials.from_service_account_file(
            GSHEET_CREDENTIALS_FILE,
            scopes=["https://www.googleapis.com/auth/spreadsheets"]
        )
        ws = gspread.authorize(creds).open(GSHEET_SPREADSHEET_NAME).worksheet(GSHEET_WORKSHEET_NAME)
        if not ws.get_all_values():
            ws.append_row(["Timestamp","Agent","Debtor Code","Campaign","Photo Path","Remark","Month","Source"])
        ws.append_rows([[
            e["timestamp"], e["agent"], e["debtor_code"], e["campaign"],
            e["photo_path"], e["remark"], e["month"], e.get("source","")
        ] for e in entries])
        print(f"  ✅ {len(entries)} rows appended to Google Sheet")
    except Exception as e:
        print(f"  ⚠️  Google Sheet failed: {e}")


def parse_date(prompt, default) -> datetime:
    while True:
        raw = input(f"{prompt} [{default}]: ").strip() or default
        try:
            return datetime.strptime(raw, "%d/%m/%Y").replace(tzinfo=timezone.utc)
        except ValueError:
            print("  ❌ Use DD/MM/YYYY format")


# ─────────────────────────────────────────
#  SCRAPER
# ─────────────────────────────────────────

async def scrape(date_from: datetime, date_to: datetime, download_photos: bool):
    PHOTO_DIR.mkdir(exist_ok=True)
    log = load_gift_log()
    new_entries = []
    skipped = 0
    no_code = 0

    print(f"\n  Connecting to Telegram...")
    async with TelegramClient("catchgift_session", API_ID, API_HASH) as client:
        print(f"  ✅ Logged in")

        try:
            group = await client.get_entity(GROUP_NAME)
            print(f"  📱 Group: {group.title}")
        except Exception as e:
            print(f"  ❌ Cannot find group: {e}")
            return

        print(f"  🧵 Topic: 生日礼物 (ID: {TOPIC_ID})")
        print(f"  📅 Range: {date_from.strftime('%d %b %Y')} → {date_to.strftime('%d %b %Y')}")
        print(f"  Scanning...\n")

        photo_msgs  = {}   # msg_id → data
        code_replies = {}  # replied_msg_id → code info
        msg_count = 0

        # Single pass — collect everything in the topic
        async for msg in client.iter_messages(group, reply_to=TOPIC_ID):
            msg_dt = msg.date.replace(tzinfo=timezone.utc)
            if msg_dt < date_from:
                break
            if msg_dt > date_to:
                continue

            msg_count += 1
            if msg_count % 100 == 0:
                print(f"  ... scanned {msg_count} messages")

            # Store photos
            if msg.media and isinstance(msg.media, MessageMediaPhoto):
                sender = await msg.get_sender()
                photo_msgs[msg.id] = {
                    "sender":    sender,
                    "timestamp": msg_dt,
                    "photo":     msg.media.photo,
                    "caption":   msg.message or "",
                }

            # Store text replies that look like debtor codes
            if msg.reply_to and msg.message:
                code = extract_debtor_code(msg.message)
                if code:
                    replied_id = msg.reply_to.reply_to_msg_id
                    code_replies[replied_id] = {"code": code, "text": msg.message}

        print(f"\n  📊 {msg_count} messages scanned")
        print(f"  📷 {len(photo_msgs)} photos found")
        print(f"  🔗 {len(code_replies)} code replies found\n")

        # Process each photo
        for msg_id, data in photo_msgs.items():
            agent     = get_display_name(data["sender"])
            timestamp = data["timestamp"]
            caption   = data["caption"]

            # Get debtor code — from caption first, then from a reply
            debtor_code = extract_debtor_code(caption)
            remark = caption

            if not debtor_code and msg_id in code_replies:
                debtor_code = code_replies[msg_id]["code"]
                remark = code_replies[msg_id]["text"]

            if not debtor_code:
                no_code += 1
                print(f"  ⚠️  No code: {agent} at {timestamp.strftime('%d %b %H:%M')} | caption: '{caption[:40]}'")
                continue

            ts_str = timestamp.strftime("%Y-%m-%d %H:%M:%S")
            if is_duplicate(log, agent, debtor_code, ts_str):
                skipped += 1
                continue

            # Download photo if requested
            photo_path = ""
            if download_photos:
                try:
                    fname    = f"{debtor_code}_{ts_str.replace(':','').replace(' ','_')}.jpg"
                    fpath    = PHOTO_DIR / fname
                    if not fpath.exists():
                        await client.download_media(data["photo"], file=str(fpath))
                    photo_path = str(fpath)
                except Exception as e:
                    print(f"  ⚠️  Photo download failed: {e}")

            entry = build_entry(agent, debtor_code, photo_path, timestamp, remark)
            log.append(entry)
            new_entries.append(entry)
            print(f"  ✅ {agent:25s} | {debtor_code:10s} | {entry['campaign']:15s} | {ts_str}")

    save_gift_log(log)
    log_to_gsheet(new_entries)

    print(f"""
  ════════════════════════════════════
   catchgift_bot — Backfill Complete
  ════════════════════════════════════
   New entries logged : {len(new_entries)}
   Skipped (dupes)    : {skipped}
   No code found      : {no_code}
   gift_log.json      : {len(log)} total entries
  ════════════════════════════════════
""")


# ─────────────────────────────────────────
#  MAIN
# ─────────────────────────────────────────

def main():
    print("""
  ╔══════════════════════════════════════╗
  ║   catchgift_bot — Backfill Scraper  ║
  ║   GRP 2A  |  生日礼物 Topic         ║
  ╚══════════════════════════════════════╝
""")

    if API_ID == 0 or API_HASH == "YOUR_API_HASH_HERE":
        print("  ❌ Fill in API_ID and API_HASH in catchgift_backfill.py first!")
        input("\n  Press Enter to exit...")
        return

    date_from = parse_date("  From date (DD/MM/YYYY)", "01/03/2026")
    date_to   = parse_date("  To date   (DD/MM/YYYY)", "07/04/2026")
    date_to   = date_to.replace(hour=23, minute=59, second=59)

    if date_from > date_to:
        print("  ❌ From date must be before To date.")
        return

    dl = input("\n  Download photos? (Y/n): ").strip().lower()
    download_photos = dl != "n"

    confirm = input("  Start scraping? (Y/n): ").strip().lower()
    if confirm == "n":
        print("  Cancelled.")
        return

    asyncio.run(scrape(date_from, date_to, download_photos))
    input("\n  Press Enter to exit...")


if __name__ == "__main__":
    main()
