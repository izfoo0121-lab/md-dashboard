@echo off
title catchgift_bot — Backfill Scraper
echo.
echo  ==========================================
echo   catchgift_bot  ^|  Historical Backfill
echo  ==========================================
echo.

cd /d C:\Users\tgy_3\Desktop\md-dashboard

:: Install Telethon if not already installed
pip show telethon >nul 2>&1
if errorlevel 1 (
    echo  Installing Telethon...
    pip install telethon --quiet
)

python catchgift_backfill.py
pause
