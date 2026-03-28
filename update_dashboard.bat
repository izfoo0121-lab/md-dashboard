@echo off
echo ==========================================
echo   MD Dashboard - Daily Update
echo ==========================================
echo.

REM Step 1: Run Python processor
echo [1/3] Processing Excel files...
python process_data.py
if errorlevel 1 (
    echo ERROR: process_data.py failed!
    pause
    exit /b 1
)

REM Step 2: Git add + commit + push
echo.
echo [2/3] Uploading to GitHub...
git add dashboard_data.json
git commit -m "Daily update %date% %time%"
git push origin main

if errorlevel 1 (
    echo ERROR: Git push failed! Check your internet connection.
    pause
    exit /b 1
)

echo.
echo [3/3] Done!
echo ==========================================
echo   Dashboard updated successfully!
echo   Agents can refresh their browser now.
echo ==========================================
echo.
pause
