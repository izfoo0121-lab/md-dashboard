@echo off
echo ============================================
echo  MIRACLE-奇迹 MD DASHBOARD — Daily Update
echo ============================================
echo.

REM ── Usage ────────────────────────────────────────────────────────
REM Normal daily:              update_dashboard.bat
REM Fast (skip debtor recalc): update_dashboard.bat fast
REM Regen past month:          update_dashboard.bat "Mar 26"
REM Regen past month fast:     update_dashboard.bat "Mar 26" fast
REM ─────────────────────────────────────────────────────────────────

set MONTH_OVERRIDE=
set FAST_FLAG=

if /i "%~1"=="fast" (
    set FAST_FLAG=--fast
) else if not "%~1"=="" (
    set MONTH_OVERRIDE=%~1
    if /i "%~2"=="fast" set FAST_FLAG=--fast
)

REM ── Find Python ─────────────────────────────────────────────────
set PYTHON=
where py >nul 2>&1 && set PYTHON=py -3.11
if "%PYTHON%"=="" where python3 >nul 2>&1 && set PYTHON=python3
if "%PYTHON%"=="" where python >nul 2>&1 && set PYTHON=python
if "%PYTHON%"=="" (
    echo ERROR: Python not found!
    pause & exit /b 1
)

REM ── Step 1: Process data ────────────────────────────────────────
if "%MONTH_OVERRIDE%"=="" (
    if "%FAST_FLAG%"=="" (
        echo [1/4] Processing sales data ^(current month^)...
        %PYTHON% process_data.py
    ) else (
        echo [1/4] Processing sales data ^(FAST mode - debtor cache^)...
        %PYTHON% process_data.py --fast
    )
) else (
    if "%FAST_FLAG%"=="" (
        echo [1/4] Processing: %MONTH_OVERRIDE%
        %PYTHON% process_data.py --month "%MONTH_OVERRIDE%"
    ) else (
        echo [1/4] Processing: %MONTH_OVERRIDE% ^(FAST mode^)
        %PYTHON% process_data.py --month "%MONTH_OVERRIDE%" --fast
    )
)
if %errorlevel% neq 0 (
    echo ERROR: process_data.py failed!
    pause & exit /b 1
)
echo Done.
echo.

REM ── Step 2: Save history ────────────────────────────────────────
echo [2/4] Saving monthly history...
%PYTHON% save_history.py
if %errorlevel% neq 0 echo WARNING: save_history.py failed ^(non-critical^)
echo Done.
echo.

REM ── Step 3: Generate history.json ───────────────────────────────
echo [3/4] Generating history.json...
%PYTHON% save_history_json.py
if %errorlevel% neq 0 echo WARNING: save_history_json.py failed ^(non-critical^)
echo Done.
echo.

REM ── Step 4: Push to GitHub ──────────────────────────────────────
echo [4/4] Pushing to GitHub...
git add dashboard_data.json history.xlsx history.json targets.json
git add sales_dashboard.html management.html admin.html
git add data_*.json months_index.json 2>nul
if "%MONTH_OVERRIDE%"=="" (
    git commit -m "Daily update %date% %time%"
) else (
    git commit -m "Regenerate %MONTH_OVERRIDE% — %date% %time%"
)
git push origin main
if %errorlevel% neq 0 (
    echo ERROR: Git push failed!
    pause & exit /b 1
)
echo Done.
echo.

echo ============================================
if "%MONTH_OVERRIDE%"=="" (echo  Dashboard updated!) else (echo  %MONTH_OVERRIDE% regenerated!)
if not "%FAST_FLAG%"=="" echo  ^(Fast mode - debtor cards from cache^)
echo ============================================
echo.
echo  Agent:      https://izfoo0121-lab.github.io/md-dashboard
echo  Management: https://izfoo0121-lab.github.io/md-dashboard/management.html
echo  Admin:      https://izfoo0121-lab.github.io/md-dashboard/admin.html
echo  Campaigns:  https://izfoo0121-lab.github.io/md-dashboard/campaigns.html
echo.
pause
