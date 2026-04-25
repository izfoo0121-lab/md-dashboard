# 📦 MIRACLE Stock Listener Bot — Setup Guide

A Telegram bot that **listens** to your existing 5 stock-operation topics in the
Wwwwwwwwww High School 2.0 group, parses the template messages silently, and
sends you one clean digest every evening.

---

## 🎯 What Changed From v1

| Old (v1 upload bot) | New (v2 listener bot) |
|---|---|
| You export 3 AutoCount Excel files daily | Bot listens to topics automatically |
| Drop files into Telegram → bot parses | Agents post templates → bot parses |
| AutoCount is the data source | **Telegram messages are the data source** |
| Bot replied to every upload | Bot is silent during the day |
| 1 topic for everything | Reads from 5 separate topics |

**Result:** Zero daily work for you. Agents already post these templates as part of their normal workflow — bot just captures them at source.

---

## 📂 File Inventory

| File | Purpose |
|---|---|
| `stock_bot_listener.py` | Main bot — listens to topics |
| `parsers.py` | Parses the 3 template types (order, transfer, GRN) |
| `digest.py` | Builds the daily summary |
| `sku_master.json` | All 41 SKUs (CCOM + 8COM) with aliases |
| `stock_admin.html` | Browser-based config editor + unknown-SKU queue |
| `run_stock_bot.bat` | Windows launcher |
| `.env.example` | Environment variable template |
| `requirements_stockbot.txt` | Python deps |
| `orders_log.json` | Auto-appended — every parsed order |
| `grn_log.json` | Auto-appended — every parsed 来货 |
| `transfers_log.json` | Auto-appended — every parsed transfer |
| `unknown_skus.json` | Flagged items to review |
| `_processed_messages.json` | Dedupe cache |

---

## 🚀 Setup Steps (one-time, ~15 minutes)

### 1. Create the bot with @BotFather

1. Open Telegram → `@BotFather` → `/newbot`
2. Name: `Miracle Stock Listener`
3. Username: something like `miracle_stock_listener_bot`
4. **Copy the token** (e.g. `1234567890:ABCdef...`)

### 2. ⚠ CRITICAL: Disable Privacy Mode

Telegram bots by default **only see commands and mentions** in groups. This bot needs to read every template message posted, so you MUST turn privacy off:

1. In @BotFather: `/mybots` → select your bot → **Bot Settings** → **Group Privacy** → **Turn Off**
2. Confirm it says "Privacy mode is disabled for [BotName]"

**Without this step, the bot will receive nothing from the topics and nothing will be logged.**

### 3. Add bot to your group

1. Go to "Wwwwwwwwww High School 2.0" group → Add Members → search your bot → add
2. Promote to admin (right-click → Promote → just give "Read Messages" permission minimum, no admin actions needed)

### 4. Install Python dependencies

On your Windows machine (same path as your existing dashboard):

```cmd
cd C:\Users\tgy_3\Desktop\md-dashboard\stock_bot
py -3.11 -m pip install -r requirements_stockbot.txt
```

### 5. First launch — discover topic IDs

With only `STOCK_BOT_TOKEN` set, run the bot once:

```cmd
set STOCK_BOT_TOKEN=YOUR_TOKEN_HERE
py -3.11 stock_bot_listener.py
```

Then in Telegram — go to **each** of these 5 topics and send `/chatid`. Bot replies with:

```
chat_id: -1001234567890
thread_id: 45
chat_type: supergroup
```

Write down the `chat_id` (same for all topics) and the `thread_id` of each topic:

| Topic | thread_id |
|---|---|
| 订货 (C com) | ____ |
| 8公司 订货 | ____ |
| Stock Transfer | ____ |
| 来货单 (C com) | ____ |
| 来货单 (8公司) | ____ |
| MD private topic | ____ |

Also DM the bot and send `/chatid` → note YOUR `user_id` (for `ADMIN_USER_IDS`).

Stop the bot (Ctrl+C).

### 6. Fill in `.env`

Two options:

**Option A — Use the admin UI (recommended):**
1. Open `stock_admin.html` in a browser
2. Go to **📡 Topics** tab
3. Paste all the IDs into the form
4. Click **📄 Generate .env content** → click the Download button
5. Save as `.env` next to `stock_bot_listener.py`

**Option B — Manual:**
Copy `.env.example` to `.env` and edit with notepad.

### 7. Launch for real

Double-click `run_stock_bot.bat`. You should see:

```
✓ SKU master loaded (41 SKUs)
Listening to 5 topics: {45: ('order','CCOM'), 46: ('order','8COM'), ...}
Daily digest scheduled at 20:00:00
Listener bot starting — silent mode, parsing topics...
```

### 8. Verify it's working

Have someone (or yourself) post a test order in the 订货 (C com) topic — just EVO-5 as a line item is enough. Then send `/today` to the bot in DM or your MD topic.

You should see:
```
🌙 STOCK DIGEST — 21 Apr 2026 (Tue)
━━━━━━━━━━━━━━━━━━━━
📥 ORDERS TODAY
CCOM (1 orders · 5 CTN)
  • BEN → EVO 5  (5)
...
```

---

## 📲 Daily Usage

### For agents (unchanged)
Nothing changes. They keep posting in the same 5 topics using the same templates.

### For you
You basically never touch the bot. But if you want details mid-day:

| Command | What you get |
|---|---|
| `/today` | Full digest right now |
| `/yesterday` | Yesterday's digest |
| `/date 2026-04-15` | Specific date |
| `/agent JACKY` | Jacky's last 7 days (orders, GRN, transfers) |
| `/missing` | Orders with no GRN match (chase these) |
| `/unknown` | Unknown SKUs queued for review |
| `/reload` | Reload `sku_master.json` after editing |
| `/chatid` | Echo chat + thread (for debugging) |
| `/help` | Menu |

### Weekly housekeeping (~5 min)
1. Send `/unknown` to bot
2. Open `stock_admin.html` → **❓ Unknown Queue** tab → upload `unknown_skus.json`
3. Attach each raw SKU to the right canonical (dropdown)
4. Save `sku_master.json`, replace in folder
5. Send `/reload` to bot

After a few weeks, unknowns become rare — parser learns your team's typos.

---

## 🔧 Troubleshooting

**Bot is running but nothing is being logged**
- Privacy mode probably still ON. Go back to step 2.
- Check: send `/chatid` in a watched topic. Does bot respond? If yes, privacy is fine. If no, privacy still on.

**Commands don't respond**
- Bot only responds to commands in DM (from ADMIN_USER_IDS) or in MD topic.
- Verify your user_id is in `ADMIN_USER_IDS` env var.
- Or, if `MD_TOPIC_ID` is set, commands work in that topic for anyone.

**Orders parsed with wrong agent**
- Add alias in `sku_master.json` → `agent_aliases`. E.g. if BEN sometimes types his name as "Benny", add `"Benny"` to `BEN`'s alias list.

**SKU appearing as unknown**
- Normal at first. Send `/unknown` weekly. Add aliases in admin UI.
- After ~2 weeks, the unknown queue should drop to near-zero.

**Daily digest didn't fire**
- Bot must be running at push time (8pm by default).
- Check `DAILY_PUSH_HOUR` / `DAILY_PUSH_MINUTE` in `.env`.
- Test manually: send `/today` to the bot.

**`*` (amend marker) not being detected**
- Parser expects `*` immediately after number: `EVO-20*` or `EVO 20 *` work.
- `EVO-*20` or `*EVO-20` won't work.

**Amended orders aren't being replaced**
- Currently every order message appends a new entry to `orders_log.json`.
- If Jacky amends his order 3 times, you'll see 3 entries for Jacky on that date.
- The digest uses the LATEST entry per (agent, date, company). Older entries are kept for audit.
- If you want stricter replace-on-amend, tell me and I'll add that logic.

---

## 🏭 Production Notes

### Keep the bot running 24/7

The listener must be running when agents post, or you miss messages (they won't re-send).

**Options:**
1. **Task Scheduler** (easiest): create task "MiracleStockBot" → trigger "At startup" → action `run_stock_bot.bat` → restart on failure
2. **NSSM** (Windows service): proper service with auto-restart
3. **Cloud** (Render.com, Railway, fly.io — ~$5/mo): no "my computer was off" problems, recommended long-term

### Backup strategy

Your `orders_log.json` / `grn_log.json` / `transfers_log.json` are the permanent audit trail. Back these up daily to:
- GitHub Gist (same pattern as GistSync — cross-device sync + version history)
- OneDrive / Google Drive
- Your existing md-dashboard repo (private)

### Scaling note

Each log file caps at 5000 entries by default (oldest trimmed). For GRP 2A at ~50 messages/day, that's 100 days of retention. Adjust `cap` in `_append()` if you want more.

---

## 🌐 Web Dashboard (stock.html)

The bot now includes an optional **web view** that reads the same data as Telegram — so you can check stock from any browser (laptop, phone, tablet) without opening Telegram.

### How it works
1. Bot parses messages → writes to local JSON logs
2. After each parse, bot pushes logs to your existing MD Dashboard **Gist** (same one sales_dashboard.html uses)
3. `stock.html` reads from that Gist → displays tables, filters, velocity charts

### Setup (one-time)
1. In `.env`, set `GITHUB_TOKEN` (same token you use for GistSync in your other dashboards)
2. Leave `GITHUB_GIST_ID` as the default (it matches your existing gist)
3. Restart the bot — you'll see `✓ Gist sync enabled` on startup
4. Upload `stock.html` to your github pages repo (same folder as `management.html`, `sales_dashboard.html`)
5. Open `https://izfoo0121-lab.github.io/md-dashboard/stock.html`

### Features in stock.html
- **KPI strip**: Orders today · GRN today · Transfers today · Missing GRN count
- **7 sub-tabs**: Summary, Orders, Received, Transfers, Missing, Unknown, Velocity
- **Filters**: Company (CCOM / 8公司 / All), Date range, Agent
- **Velocity chart**: 7-day rolling SKU demand (which brands moving fastest)
- **Missing GRN table**: Orders ≥1 day old with no matching received entry
- **Unknown SKU queue**: Same data as `/unknown` command — visible on web

### Commands related to web sync
- `/syncnow` — force push right now (useful after bulk edits)
- Bot auto-pushes ~30 seconds after each parse (debounced to avoid API spam)
- Bot always pushes before the 8pm digest

---

## 🎯 What's Next (not built yet, easy additions)

- **Auto-reconciliation with AutoCount weekly** — re-use the old `process_stock.py` as a cross-check
- **Low-stock alerts** — when an agent's cumulative order minus transfers drops below a threshold, alert MD topic
- **Order template enforcer** — reply to agent if template is malformed (but only privately to avoid spam)
- **OCR on 来货单 photos** — handwritten receipt → extracted line items (using Claude vision or Tesseract)

---

## 🆘 Support

All of this was built modularly. If something breaks:
1. `stock_bot_listener.py` → bot logic (commands, message routing)
2. `parsers.py` → if parsing is wrong, look here
3. `digest.py` → if the digest looks off, look here
4. `sku_master.json` → if wrong SKUs are matching, edit aliases

Every parse failure writes a warning to the log entry — check `orders_log.json` for `"warnings": [...]`.

Built by Claude for Isaac (@GT138888) · Miracle 奇迹 · GRP 2A.
