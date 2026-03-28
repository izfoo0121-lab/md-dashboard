@echo off
echo ============================================
echo  TOURO MD DASHBOARD — Daily Update
echo ============================================
echo.

REM ── Step 1: Run data processing ──────────────────────────────────────────
echo [1/3] Processing data...
python process_data.py
if %errorlevel% neq 0 (
    echo.
    echo ❌ ERROR: process_data.py failed!
    echo    Check that MD Sales Report.xlsx and Debtor Maintenance.xlsx
    echo    are in this folder and try again.
    pause
    exit /b 1
)
echo ✅ dashboard_data.json updated
echo.

REM ── Step 2: Git add + commit + push ──────────────────────────────────────
echo [2/3] Pushing to GitHub...
git add dashboard_data.json
git add targets.json 2>nul
git commit -m "Daily update %date% %time%"
git push origin main
if %errorlevel% neq 0 (
    echo.
    echo ❌ ERROR: Git push failed!
    echo    Check your internet connection and GitHub credentials.
    pause
    exit /b 1
)
echo ✅ Pushed to GitHub
echo.

REM ── Step 3: Done ─────────────────────────────────────────────────────────
echo [3/3] Done!
echo.
echo ============================================
echo  ✅ Dashboard updated successfully!
echo ============================================
echo.
echo  Agent view:      https://touro-sales.streamlit.app
echo  Management view: https://touro-sales.streamlit.app/?page=management
echo  Admin page:      https://touro-sales.streamlit.app/?page=admin
echo.
echo  Agents can now refresh their browser to see updated data.
echo.
pause
