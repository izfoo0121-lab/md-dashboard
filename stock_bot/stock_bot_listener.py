"""
stock_bot_listener.py
=====================
MIRACLE 奇迹 — Stock Monitoring Bot (listener-based)

Listens to 5 configured topics in the Wwwwwwwwww High School 2.0 group:
  • CCOM  orders   (订货 C com)
  • 8COM  orders   (8公司 订货)
  • CCOM  GRN      (来货单 C com)
  • 8COM  GRN      (来货单 8公司)
  • Stock transfer (1 shared topic for both companies)

Behaviour:
  • SILENT during the day — does NOT reply in topics (per Isaac's choice)
  • Parses each message and appends to orders_log.json / grn_log.json / transfers_log.json
  • Flags unknown SKUs in unknown_skus.json for Isaac to review later
  • Sends ONE daily digest at configured time to a private MD topic (or DM Isaac)

Commands (only respond in MD topic or DM from ADMIN_USER_IDS):
  /today          — show today's digest now
  /yesterday      — yesterday's digest
  /date YYYY-MM-DD — digest for specific date
  /agent <name>   — last 7 days activity for that agent
  /missing        — pending orders (no GRN yet)
  /unknown        — list unknown SKU queue
  /chatid         — utility: echo chat + thread id (for setup)
  /reload         — reload sku_master.json (after editing via admin)
  /help           — list commands

Setup env vars:
  STOCK_BOT_TOKEN       required
  MD_CHAT_ID            the group chat id (e.g. -1003...)
  MD_TOPIC_ID           thread id of the private MD topic (or 0 for DM-only)
  TOPIC_CCOM_ORDER      topic id for 订货 C com
  TOPIC_8COM_ORDER      topic id for 8公司 订货
  TOPIC_TRANSFER        topic id for Stock Transfer
  TOPIC_CCOM_GRN        topic id for 来货单 C com
  TOPIC_8COM_GRN        topic id for 来货单 8公司
  ADMIN_USER_IDS        comma-separated telegram user ids who can use commands
  DAILY_PUSH_HOUR       default 20
  DAILY_PUSH_MINUTE     default 0
"""
from __future__ import annotations
import os
import sys
import json
import logging
from datetime import datetime, time as dtime, timedelta
from pathlib import Path
from typing import Any

from telegram import Update, constants
from telegram.ext import (
    Application, CommandHandler, MessageHandler, ContextTypes, filters,
)

BASE = Path(__file__).parent.resolve()
sys.path.insert(0, str(BASE))

from parsers import SkuMaster, parse_order, parse_transfer, parse_grn
from digest import build_digest
from gist_sync import GistSync

# ── Files ─────────────────────────────────────────────────────────────────
SKU_MASTER_FILE   = BASE / 'sku_master.json'
ORDERS_FILE       = BASE / 'orders_log.json'
GRN_FILE          = BASE / 'grn_log.json'
TRANSFERS_FILE    = BASE / 'transfers_log.json'
UNKNOWN_FILE      = BASE / 'unknown_skus.json'
SEEN_FILE         = BASE / '_processed_messages.json'  # dedupe

# ── Env config ────────────────────────────────────────────────────────────
def _env_int(k: str, default: int = 0) -> int:
    v = os.environ.get(k, '').strip()
    if not v: return default
    try: return int(v)
    except: return default

BOT_TOKEN        = os.environ.get('STOCK_BOT_TOKEN', '').strip()
MD_CHAT_ID       = _env_int('MD_CHAT_ID')
MD_TOPIC_ID      = _env_int('MD_TOPIC_ID')
TOPIC_CCOM_ORDER = _env_int('TOPIC_CCOM_ORDER')
TOPIC_8COM_ORDER = _env_int('TOPIC_8COM_ORDER')
TOPIC_TRANSFER   = _env_int('TOPIC_TRANSFER')
TOPIC_CCOM_GRN   = _env_int('TOPIC_CCOM_GRN')
TOPIC_8COM_GRN   = _env_int('TOPIC_8COM_GRN')
ADMIN_USER_IDS   = {int(x) for x in os.environ.get('ADMIN_USER_IDS', '').split(',') if x.strip().isdigit()}
DAILY_PUSH_HOUR   = _env_int('DAILY_PUSH_HOUR', 20)
DAILY_PUSH_MINUTE = _env_int('DAILY_PUSH_MINUTE', 0)

# Gist sync — shared with existing MD dashboard gist
GIST_SYNC = GistSync(BASE, debounce_seconds=_env_int('GIST_DEBOUNCE_SECONDS', 30))

# Topic → (kind, company) mapping
TOPIC_MAP: dict[int, tuple[str, str | None]] = {}
def _rebuild_topic_map():
    TOPIC_MAP.clear()
    if TOPIC_CCOM_ORDER: TOPIC_MAP[TOPIC_CCOM_ORDER] = ('order', 'CCOM')
    if TOPIC_8COM_ORDER: TOPIC_MAP[TOPIC_8COM_ORDER] = ('order', '8COM')
    if TOPIC_CCOM_GRN:   TOPIC_MAP[TOPIC_CCOM_GRN]   = ('grn', 'CCOM')
    if TOPIC_8COM_GRN:   TOPIC_MAP[TOPIC_8COM_GRN]   = ('grn', '8COM')
    if TOPIC_TRANSFER:   TOPIC_MAP[TOPIC_TRANSFER]   = ('transfer', None)
_rebuild_topic_map()

# ── Logging ───────────────────────────────────────────────────────────────
logging.basicConfig(
    format='%(asctime)s — %(name)s — %(levelname)s — %(message)s',
    level=logging.INFO,
)
log = logging.getLogger('stock_listener')


# ── Storage helpers ───────────────────────────────────────────────────────
def _load_list(path: Path) -> list[dict]:
    if not path.exists(): return []
    try: return json.loads(path.read_text(encoding='utf-8'))
    except: return []

def _save_list(path: Path, arr: list[dict]) -> None:
    path.write_text(json.dumps(arr, indent=2, ensure_ascii=False), encoding='utf-8')

def _append(path: Path, entry: dict, cap: int = 5000) -> None:
    arr = _load_list(path)
    arr.append(entry)
    if len(arr) > cap:
        arr = arr[-cap:]
    _save_list(path, arr)

def _already_seen(msg_id: int, chat_id: int) -> bool:
    seen = _load_list(SEEN_FILE)
    key = f"{chat_id}_{msg_id}"
    return any(s.get('key') == key for s in seen)

def _mark_seen(msg_id: int, chat_id: int) -> None:
    seen = _load_list(SEEN_FILE)
    key = f"{chat_id}_{msg_id}"
    seen.append({'key': key, 'at': datetime.now().isoformat()})
    if len(seen) > 10000:
        seen = seen[-5000:]
    _save_list(SEEN_FILE, seen)


# ── Logging parse results ─────────────────────────────────────────────────
def _log_order(result: dict, msg: Any) -> None:
    entry = {
        'kind':        'order',
        'company':     result['company'],
        'agent':       result['agent'],
        'date':        result['date'],
        'lines':       result['lines'],
        'total_hint':  result['total_hint'],
        'meta':        result['meta'],
        'warnings':    result['warnings'],
        'message_id':  getattr(msg, 'message_id', None),
        'chat_id':     getattr(msg.chat, 'id', None) if msg and msg.chat else None,
        'posted_at':   datetime.now().isoformat(),
        'raw_snippet': (result['raw'] or '')[:500],
    }
    _append(ORDERS_FILE, entry)
    _log_unknowns(result, kind='order', msg=msg)

def _log_grn(result: dict, msg: Any) -> None:
    entry = {
        'kind':        'grn',
        'company':     result['company'],
        'agent':       result['agent'],
        'date':        result['date'],
        'lines':       result['lines'],
        'total_hint':  result['total_hint'],
        'meta':        result['meta'],
        'warnings':    result['warnings'],
        'message_id':  getattr(msg, 'message_id', None),
        'chat_id':     getattr(msg.chat, 'id', None) if msg and msg.chat else None,
        'posted_at':   datetime.now().isoformat(),
        'raw_snippet': (result['raw'] or '')[:500],
    }
    _append(GRN_FILE, entry)
    _log_unknowns(result, kind='grn', msg=msg)

def _log_transfer(result: dict, msg: Any) -> None:
    entry = {
        'kind':        'transfer',
        'role':        result['role'],
        'company':     result['company'],
        'from_agent':  result['from_agent'],
        'to_agent':    result['to_agent'],
        'date':        result['date'],
        'lines':       result['lines'],
        'reason_key':  result['meta'].get('reason_key'),
        'reason_text': result['meta'].get('reason_text'),
        'approved_by': result['meta'].get('approved_by'),
        'cc':          result['meta'].get('cc'),
        'account':     result['meta'].get('account'),
        'warnings':    result['warnings'],
        'message_id':  getattr(msg, 'message_id', None),
        'chat_id':     getattr(msg.chat, 'id', None) if msg and msg.chat else None,
        'posted_at':   datetime.now().isoformat(),
        'raw_snippet': (result['raw'] or '')[:500],
    }
    _append(TRANSFERS_FILE, entry)
    _log_unknowns(result, kind='transfer', msg=msg)

def _log_unknowns(result: dict, kind: str, msg: Any) -> None:
    for raw_sku in result.get('unknown_skus', []):
        _append(UNKNOWN_FILE, {
            'raw_sku':   raw_sku,
            'kind':      kind,
            'company':   result.get('company'),
            'agent':     result.get('agent') or result.get('from_agent'),
            'date':      result.get('date'),
            'logged_at': datetime.now().strftime('%Y-%m-%d %H:%M:%S'),
            'msg_id':    getattr(msg, 'message_id', None),
        })


# ── Message handler (the heart of the listener) ──────────────────────────
MASTER: SkuMaster | None = None

def _ensure_master() -> SkuMaster:
    global MASTER
    if MASTER is None:
        MASTER = SkuMaster(SKU_MASTER_FILE)
    return MASTER


async def on_group_message(update: Update, context: ContextTypes.DEFAULT_TYPE) -> None:
    """Every non-command message in a watched topic is routed here."""
    msg = update.effective_message
    if not msg or not msg.text:
        return
    chat = update.effective_chat
    if not chat or chat.id != MD_CHAT_ID:
        return  # only process our configured group
    thread_id = getattr(msg, 'message_thread_id', None)
    if thread_id not in TOPIC_MAP:
        return  # not a watched topic
    if _already_seen(msg.message_id, chat.id):
        return
    
    kind, company = TOPIC_MAP[thread_id]
    master = _ensure_master()
    text = msg.text
    
    try:
        if kind == 'order':
            result = parse_order(text, master, company or 'CCOM')
            if result:
                _log_order(result, msg)
                log.info(f"📥 Order parsed: {company} {result.get('agent')} "
                         f"— {len(result['lines'])} lines, {len(result['unknown_skus'])} unknown")
                GIST_SYNC.schedule()
        elif kind == 'grn':
            result = parse_grn(text, master, company or 'CCOM')
            if result:
                _log_grn(result, msg)
                log.info(f"📦 GRN parsed: {company} {result.get('agent')} "
                         f"— {len(result['lines'])} lines, {len(result['unknown_skus'])} unknown")
                GIST_SYNC.schedule()
        elif kind == 'transfer':
            result = parse_transfer(text, master)
            if result:
                _log_transfer(result, msg)
                log.info(f"🔄 Transfer parsed: {result.get('from_agent')} → {result.get('to_agent')} "
                         f"({result.get('role')})")
                GIST_SYNC.schedule()
    except Exception as e:
        log.exception(f"Parse failure on msg {msg.message_id}: {e}")
    
    _mark_seen(msg.message_id, chat.id)


# ── Commands (MD-only) ───────────────────────────────────────────────────
def _is_authorised(update: Update) -> bool:
    """Commands only work in DMs from admin, OR in the MD topic."""
    user_id = update.effective_user.id if update.effective_user else 0
    chat = update.effective_chat
    msg = update.effective_message
    # DM from admin
    if chat and chat.type == 'private' and (not ADMIN_USER_IDS or user_id in ADMIN_USER_IDS):
        return True
    # Group + MD topic
    if chat and chat.id == MD_CHAT_ID:
        thread = getattr(msg, 'message_thread_id', None) if msg else None
        if MD_TOPIC_ID and thread == MD_TOPIC_ID:
            return True
    return False


async def cmd_help(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not _is_authorised(update):
        return
    txt = (
        "*📦 Stock Bot Commands*\n\n"
        "*Digest:*\n"
        "`/today` — today's full digest\n"
        "`/yesterday` — yesterday's digest\n"
        "`/date 2026-04-21` — digest for a specific date\n\n"
        "*Drill-down:*\n"
        "`/agent BEN` — last 7 days for BEN\n"
        "`/missing` — orders with no GRN\n"
        "`/unknown` — unknown-SKU queue\n\n"
        "*Admin:*\n"
        "`/reload` — reload sku_master.json\n"
        "`/chatid` — show this chat/thread id\n"
        "`/help` — this menu\n"
    )
    await update.effective_message.reply_text(txt, parse_mode=constants.ParseMode.MARKDOWN)


async def cmd_today(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not _is_authorised(update): return
    txt = build_digest(BASE, for_date=datetime.now().strftime('%Y-%m-%d'))
    await update.effective_message.reply_text(txt, parse_mode=constants.ParseMode.MARKDOWN)


async def cmd_yesterday(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not _is_authorised(update): return
    y = (datetime.now() - timedelta(days=1)).strftime('%Y-%m-%d')
    txt = build_digest(BASE, for_date=y)
    await update.effective_message.reply_text(txt, parse_mode=constants.ParseMode.MARKDOWN)


async def cmd_date(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not _is_authorised(update): return
    if not context.args:
        await update.effective_message.reply_text("Usage: `/date YYYY-MM-DD`", parse_mode=constants.ParseMode.MARKDOWN)
        return
    d = context.args[0]
    try:
        datetime.strptime(d, '%Y-%m-%d')
    except ValueError:
        await update.effective_message.reply_text("Use format YYYY-MM-DD (e.g. 2026-04-21)")
        return
    txt = build_digest(BASE, for_date=d)
    await update.effective_message.reply_text(txt, parse_mode=constants.ParseMode.MARKDOWN)


async def cmd_agent(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not _is_authorised(update): return
    if not context.args:
        await update.effective_message.reply_text("Usage: `/agent BEN`", parse_mode=constants.ParseMode.MARKDOWN)
        return
    master = _ensure_master()
    agent = master.lookup_agent(context.args[0])
    if not agent:
        await update.effective_message.reply_text(f"Unknown agent: '{context.args[0]}'")
        return
    since = (datetime.now() - timedelta(days=7)).strftime('%Y-%m-%d')
    orders    = [o for o in _load_list(ORDERS_FILE)    if o.get('agent') == agent and o.get('date','') >= since]
    grns      = [g for g in _load_list(GRN_FILE)       if g.get('agent') == agent and g.get('date','') >= since]
    transfers = [t for t in _load_list(TRANSFERS_FILE)
                 if (t.get('from_agent') == agent or t.get('to_agent') == agent)
                 and t.get('date','') >= since and t.get('role') == 'sender']  # dedupe to sender only
    lines = [f"*📋 {agent} — last 7 days*", ""]
    lines.append(f"Orders:    {len(orders)}")
    lines.append(f"GRN:       {len(grns)}")
    lines.append(f"Transfers: {len(transfers)}")
    lines.append("")
    for o in orders[-5:]:
        line_summary = ', '.join(f"{ln['sku']} {ln['qty']}" for ln in o.get('lines',[]) if ln.get('sku'))[:120]
        lines.append(f"📥 {o.get('date')}: {line_summary}")
    for g in grns[-5:]:
        line_summary = ', '.join(f"{ln['sku']} {ln['qty']}" for ln in g.get('lines',[]) if ln.get('sku'))[:120]
        lines.append(f"📦 {g.get('date')}: {line_summary}")
    for t in transfers[-5:]:
        direction = f"→ {t.get('to_agent')}" if t.get('from_agent') == agent else f"← {t.get('from_agent')}"
        line_summary = ', '.join(f"{ln['sku']} {ln['qty']}" for ln in t.get('lines',[]) if ln.get('sku'))
        lines.append(f"🔄 {t.get('date')} {direction}: {line_summary}")
    await update.effective_message.reply_text('\n'.join(lines), parse_mode=constants.ParseMode.MARKDOWN)


async def cmd_missing(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not _is_authorised(update): return
    orders = _load_list(ORDERS_FILE)
    grns = _load_list(GRN_FILE)
    today_dt = datetime.now()
    missing = []
    for o in orders:
        try:
            od = datetime.strptime(o.get('date',''), '%Y-%m-%d')
        except:
            continue
        age = (today_dt - od).days
        if age < 1 or age > 21:
            continue
        # match any GRN between order_date and today for same agent + company?
        matched = False
        for g in grns:
            try:
                gd = datetime.strptime(g.get('date',''), '%Y-%m-%d')
            except:
                continue
            if (g.get('agent') == o.get('agent')
                and g.get('company') == o.get('company')
                and od <= gd <= today_dt):
                matched = True; break
        if not matched:
            missing.append((age, o))
    missing.sort(key=lambda t: -t[0])  # oldest first
    if not missing:
        await update.effective_message.reply_text("_No missing GRNs. ✓_", parse_mode=constants.ParseMode.MARKDOWN)
        return
    lines = [f"*⚠ Missing GRNs ({len(missing)})*", ""]
    for age, o in missing[:20]:
        line_summary = ', '.join(f"{ln['sku']} {ln['qty']}" for ln in o.get('lines',[]) if ln.get('sku'))[:100]
        lines.append(f"  • {o.get('agent','?')} ({o.get('company','?')}) {o.get('date')} [{age}d] · {line_summary}")
    await update.effective_message.reply_text('\n'.join(lines), parse_mode=constants.ParseMode.MARKDOWN)


async def cmd_unknown(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not _is_authorised(update): return
    unk = _load_list(UNKNOWN_FILE)
    if not unk:
        await update.effective_message.reply_text("_No unknown SKUs. ✓_", parse_mode=constants.ParseMode.MARKDOWN)
        return
    # Count by raw sku
    from collections import Counter
    counts = Counter(u.get('raw_sku','?') for u in unk)
    lines = [f"*❓ Unknown SKU Queue ({len(unk)} entries, {len(counts)} unique)*", ""]
    for raw, count in counts.most_common(30):
        lines.append(f"  `{raw}` × {count}")
    lines.append("")
    lines.append("_Open `stock_admin.html` → SKU Master tab to add these as aliases._")
    await update.effective_message.reply_text('\n'.join(lines), parse_mode=constants.ParseMode.MARKDOWN)


async def cmd_reload(update: Update, context: ContextTypes.DEFAULT_TYPE):
    if not _is_authorised(update): return
    global MASTER
    try:
        MASTER = SkuMaster(SKU_MASTER_FILE)
        await update.effective_message.reply_text("✓ sku_master.json reloaded.")
    except Exception as e:
        await update.effective_message.reply_text(f"❌ Reload failed: {e}")


async def cmd_chatid(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Utility: anyone can use this to find topic ids during setup."""
    chat = update.effective_chat
    msg = update.effective_message
    thread = getattr(msg, 'message_thread_id', None) if msg else None
    mapping = TOPIC_MAP.get(thread)
    mapping_note = f"\nCurrently mapped as: {mapping[0]} ({mapping[1] or 'any'})" if mapping else ''
    await update.effective_message.reply_text(
        f"chat_id: {chat.id}\n"
        f"thread_id: {thread}\n"
        f"chat_type: {chat.type}{mapping_note}"
    )


async def cmd_syncnow(update: Update, context: ContextTypes.DEFAULT_TYPE):
    """Force immediate gist push. Useful after bulk edits."""
    if not _is_authorised(update): return
    if not GIST_SYNC.is_configured():
        await update.effective_message.reply_text(
            "⚠ Gist sync not configured. Set `GITHUB_TOKEN` and `GITHUB_GIST_ID` in .env.",
            parse_mode=constants.ParseMode.MARKDOWN
        )
        return
    await update.effective_message.reply_text("⏳ Pushing to Gist...")
    result = GIST_SYNC.push_now()
    if result.get('ok'):
        pushed = result.get('pushed', 0)
        await update.effective_message.reply_text(f"✓ Pushed {pushed} files to Gist.")
    else:
        await update.effective_message.reply_text(f"❌ Push failed: {result.get('error','?')}")


# ── Daily push ────────────────────────────────────────────────────────────
async def daily_push(context: ContextTypes.DEFAULT_TYPE):
    # Push latest to Gist so stock.html has fresh data
    if GIST_SYNC.is_configured():
        GIST_SYNC.push_now()
    
    if not MD_CHAT_ID or not MD_TOPIC_ID:
        log.warning("Daily push skipped — MD_CHAT_ID or MD_TOPIC_ID not set")
        return
    txt = build_digest(BASE, for_date=datetime.now().strftime('%Y-%m-%d'))
    try:
        await context.bot.send_message(
            chat_id=MD_CHAT_ID,
            message_thread_id=MD_TOPIC_ID,
            text=txt,
            parse_mode=constants.ParseMode.MARKDOWN,
        )
        log.info("Daily digest sent.")
    except Exception as e:
        log.exception(f"Daily push failed: {e}")


# ── Main ──────────────────────────────────────────────────────────────────
def main():
    if not BOT_TOKEN:
        print("ERROR: STOCK_BOT_TOKEN not set. See .env.example.")
        sys.exit(1)
    if not MD_CHAT_ID:
        print("WARNING: MD_CHAT_ID not set — commands won't be authorised.")
    if not TOPIC_MAP:
        print("WARNING: No topic IDs configured — bot will not parse any messages.")
    else:
        print(f"Listening to {len(TOPIC_MAP)} topics: {TOPIC_MAP}")
    
    # Try to load sku master early so errors surface
    try:
        _ensure_master()
        print(f"✓ SKU master loaded ({sum(len(c['skus']) for c in MASTER.data['companies'].values())} SKUs)")
    except Exception as e:
        print(f"ERROR loading sku_master.json: {e}")
        sys.exit(1)
    
    # Gist sync status
    if GIST_SYNC.is_configured():
        print(f"✓ Gist sync enabled (id: {GIST_SYNC.gist_id[:8]}…, debounce: {GIST_SYNC.debounce}s)")
    else:
        print("ℹ Gist sync DISABLED (set GITHUB_TOKEN in .env to enable stock.html web view)")
    
    app = Application.builder().token(BOT_TOKEN).build()
    
    # Commands
    app.add_handler(CommandHandler('help',      cmd_help))
    app.add_handler(CommandHandler('start',     cmd_help))
    app.add_handler(CommandHandler('today',     cmd_today))
    app.add_handler(CommandHandler('yesterday', cmd_yesterday))
    app.add_handler(CommandHandler('date',      cmd_date))
    app.add_handler(CommandHandler('agent',     cmd_agent))
    app.add_handler(CommandHandler('missing',   cmd_missing))
    app.add_handler(CommandHandler('unknown',   cmd_unknown))
    app.add_handler(CommandHandler('reload',    cmd_reload))
    app.add_handler(CommandHandler('chatid',    cmd_chatid))
    app.add_handler(CommandHandler('syncnow',   cmd_syncnow))
    
    # Group message listener (non-command text)
    app.add_handler(MessageHandler(
        filters.TEXT & ~filters.COMMAND & filters.ChatType.GROUPS,
        on_group_message
    ))
    
    # Daily push
    push_time = dtime(hour=DAILY_PUSH_HOUR, minute=DAILY_PUSH_MINUTE)
    app.job_queue.run_daily(daily_push, time=push_time)
    log.info(f"Daily digest scheduled at {push_time}")
    
    log.info("Listener bot starting — silent mode, parsing topics...")
    app.run_polling(allowed_updates=Update.ALL_TYPES)


if __name__ == '__main__':
    main()
