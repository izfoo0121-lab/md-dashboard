@echo off
echo ============================================
echo  MIRACLE-奇迹 MD DASHBOARD — Daily Update
echo ============================================
echo.

REM ── Find Python ─────────────────────────────────────────────────
set PYTHON=
where py >nul 2>&1 && set PYTHON=py
if "%PYTHON%"=="" where python3 >nul 2>&1 && set PYTHON=python3
if "%PYTHON%"=="" where python >nul 2>&1 && set PYTHON=python
if "%PYTHON%"=="" (
    echo ERROR: Python not found!
    pause & exit /b 1
)

REM ── Step 1: Process data ────────────────────────────────────────
echo [1/3] Processing sales data...
%PYTHON% process_data.py
if %errorlevel% neq 0 (
    echo ERROR: process_data.py failed!
    pause & exit /b 1
)
echo Done.
echo.

REM ── Step 2: Save history ────────────────────────────────────────
echo [2/4] Saving monthly history...
%PYTHON% save_history.py
echo Done.
echo.

REM ── Step 3: Generate history.json for GitHub Pages ───────────────
echo [3/4] Generating history.json...
%PYTHON% save_history_json.py
echo Done.
echo.

REM ── Step 4: Push to GitHub ──────────────────────────────────────
echo [4/4] Pushing to GitHub...
git add dashboard_data.json history.xlsx history.json targets.json
git commit -m "Daily update %date% %time%"
git push origin main
if %errorlevel% neq 0 (
    echo ERROR: Git push failed!
    pause & exit /b 1
)
echo Done.
echo.

echo ============================================
echo  Dashboard updated successfully!
echo ============================================
echo.
echo  Agent view:      https://izfoo0121-lab.github.io/md-dashboard
echo  Management:      https://izfoo0121-lab.github.io/md-dashboard/management.html
echo  Admin:           https://izfoo0121-lab.github.io/md-dashboard/admin.html
echo  Campaigns:       https://izfoo0121-lab.github.io/md-dashboard/campaigns.html
echo.
pause
