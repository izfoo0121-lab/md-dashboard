@echo off
REM ============================================================
REM  MIRACLE Stock Listener Bot
REM ============================================================

cd /d "%~dp0"

REM --- Token from BotFather ---
set STOCK_BOT_TOKEN=8564650438:AAES2D_W6yUORIBEEFH4BzQqmevYbaAzbjg

REM --- Group chat ID (harvest via /chatid in any topic) ---
set MD_CHAT_ID=0

REM --- MD_TOPIC_ID=0 means DM mode (Mode A) ---
set MD_TOPIC_ID=0

REM --- Topic IDs (harvested from previous session) ---
set TOPIC_CCOM_ORDER=34881
set TOPIC_8COM_ORDER=11
set TOPIC_TRANSFER=3
set TOPIC_CCOM_GRN=34878
set TOPIC_8COM_GRN=29708

REM --- Your Telegram user_id (harvest via /chatid in bot DM) ---
set ADMIN_USER_IDS=

set DAILY_PUSH_HOUR=20
set DAILY_PUSH_MINUTE=0

echo.
echo ================================================================
echo MIRACLE Stock Listener Bot
echo ================================================================
echo.

py -3.11 stock_bot_listener.py

pause