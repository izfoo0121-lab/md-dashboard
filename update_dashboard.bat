@echo off
set PYTHONIOENCODING=utf-8
echo ============================================
echo  MIRACLE MD DASHBOARD - Daily Update
echo ============================================
echo.

REM -- Usage ------------------------------------------------
REM Normal daily:              update_dashboard.bat
REM Fast (skip debtor recalc): update_dashboard.bat fast
REM Regen past month:          update_dashboard.bat "Mar 26"
REM Regen past month fast:     update_dashboard.bat "Mar 26" fast
REM ---------------------------------------------------------

set MONTH_OVERRIDE=
set FAST_FLAG=

if /i "%~1"=="fast" (
    set FAST_FLAG=--fast
) else if not "%~1"=="" (
    set MONTH_OVERRIDE=%~1
    if /i "%~2"=="fast" set FAST_FLAG=--fast
)

REM -- Find Python ------------------------------------------
set PYTHON=
where py >nul 2>&1 && set PYTHON=py -3.11
if "%PYTHON%"=="" where python3 >nul 2>&1 && set PYTHON=python3
if "%PYTHON%"=="" where python >nul 2>&1 && set PYTHON=python
if "%PYTHON%"=="" (
    echo ERROR: Python not found!
    pause & exit /b 1
)

REM -- Step 0: Verify Git can fast-forward main ----------------
echo [0/5] Checking GitHub main sync...
git rev-parse --is-inside-work-tree >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: This folder is not a Git repository.
    pause & exit /b 1
)
git fetch origin main
if %errorlevel% neq 0 (
    echo ERROR: Could not fetch origin/main.
    pause & exit /b 1
)
set LOCAL_AHEAD=
set LOCAL_BEHIND=
for /f "tokens=1,2" %%A in ('git rev-list --left-right --count HEAD...origin/main') do (
    set LOCAL_AHEAD=%%A
    set LOCAL_BEHIND=%%B
)
if "%LOCAL_AHEAD%"=="" (
    echo ERROR: Could not compare this checkout with GitHub main.
    pause & exit /b 1
)
if not "%LOCAL_AHEAD%"=="0" (
    echo ERROR: This checkout has local commits or has diverged from GitHub main.
    echo        Local ahead: %LOCAL_AHEAD% commit(s), GitHub ahead: %LOCAL_BEHIND% commit(s).
    echo        No data was regenerated, so GitHub main is protected from stale pushes.
    pause & exit /b 1
)
if not "%LOCAL_BEHIND%"=="0" (
    echo Auto-pulling latest GitHub main ^(%LOCAL_BEHIND% commit^(s^)^)...
    git pull --ff-only origin main
    if errorlevel 1 (
        echo ERROR: Could not auto-pull latest GitHub main.
        echo        Local edited files may overlap incoming GitHub changes.
        echo        Commit/stash local work or sync this folder manually, then run again.
        pause & exit /b 1
    )
)
echo Done.
echo.

REM -- Step 0b: Sync latest source workbooks ----------------
echo [0b/5] Syncing source workbooks...
set DESKTOP_SALES_FILE=%USERPROFILE%\Desktop\md-dashboard\MD Sales Report.xlsx
set LIVE_SALES_FILE=%CD%\MD Sales Report.xlsx
if exist "%DESKTOP_SALES_FILE%" (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$src='%DESKTOP_SALES_FILE%'; $dest='%LIVE_SALES_FILE%'; $s=Get-Item -LiteralPath $src; $d=Get-Item -LiteralPath $dest -ErrorAction SilentlyContinue; if (!$d -or $s.LastWriteTime -gt $d.LastWriteTime -or $s.Length -ne $d.Length) { Copy-Item -LiteralPath $src -Destination $dest -Force; Write-Host ('Copied desktop MD Sales Report: ' + $s.LastWriteTime.ToString('yyyy-MM-dd HH:mm') + ' (' + $s.Length + ' bytes)') } else { Write-Host ('Live MD Sales Report already current: ' + $d.LastWriteTime.ToString('yyyy-MM-dd HH:mm') + ' (' + $d.Length + ' bytes)') }"
    if errorlevel 1 (
        echo ERROR: Could not sync desktop MD Sales Report.
        pause & exit /b 1
    )
) else (
    echo WARNING: Desktop MD Sales Report not found: %DESKTOP_SALES_FILE%
    echo          Continuing with live folder source.
)

set DESKTOP_DEBTOR_FILE=%USERPROFILE%\Desktop\md-dashboard\Debtor Maintenance.xlsx
set LIVE_DEBTOR_FILE=%CD%\Debtor Maintenance.xlsx
if exist "%DESKTOP_DEBTOR_FILE%" (
    powershell -NoProfile -ExecutionPolicy Bypass -Command "$src='%DESKTOP_DEBTOR_FILE%'; $dest='%LIVE_DEBTOR_FILE%'; $s=Get-Item -LiteralPath $src; $d=Get-Item -LiteralPath $dest -ErrorAction SilentlyContinue; if (!$d -or $s.LastWriteTime -gt $d.LastWriteTime -or $s.Length -ne $d.Length) { Copy-Item -LiteralPath $src -Destination $dest -Force; Write-Host ('Copied desktop Debtor Maintenance: ' + $s.LastWriteTime.ToString('yyyy-MM-dd HH:mm') + ' (' + $s.Length + ' bytes)') } else { Write-Host ('Live Debtor Maintenance already current: ' + $d.LastWriteTime.ToString('yyyy-MM-dd HH:mm') + ' (' + $d.Length + ' bytes)') }"
    if errorlevel 1 (
        echo ERROR: Could not sync desktop Debtor Maintenance.
        pause & exit /b 1
    )
) else (
    echo WARNING: Desktop Debtor Maintenance not found: %DESKTOP_DEBTOR_FILE%
    echo          Continuing with live folder source.
)
echo Done.
echo.

REM -- Step 1: Process data ---------------------------------
if "%MONTH_OVERRIDE%"=="" (
    if "%FAST_FLAG%"=="" (
        echo [1/5] Processing sales data ^(current month^)...
        %PYTHON% process_data.py
    ) else (
        echo [1/5] Processing sales data ^(FAST mode - debtor cache^)...
        %PYTHON% process_data.py --fast
    )
) else (
    if "%FAST_FLAG%"=="" (
        echo [1/5] Processing: %MONTH_OVERRIDE%
        %PYTHON% process_data.py --month "%MONTH_OVERRIDE%"
    ) else (
        echo [1/5] Processing: %MONTH_OVERRIDE% ^(FAST mode^)
        %PYTHON% process_data.py --month "%MONTH_OVERRIDE%" --fast
    )
)
if %errorlevel% neq 0 (
    echo ERROR: process_data.py failed!
    pause & exit /b 1
)
echo Done.
echo.

REM -- Step 2: Rebuild SKU Strength report ------------------
echo [2/5] Rebuilding SKU Strength report...
if exist reports\miracle-2a-sku-strength\build_report_data.py (
    %PYTHON% reports\miracle-2a-sku-strength\build_report_data.py
    if %errorlevel% neq 0 (
        echo ERROR: SKU Strength report rebuild failed!
        pause & exit /b 1
    )
) else (
    echo WARNING: SKU Strength report builder not found ^(non-critical^)
)
echo Done.
echo.

REM -- Step 3: Save history ---------------------------------
echo [3/5] Saving monthly history...
%PYTHON% save_history.py
if %errorlevel% neq 0 echo WARNING: save_history.py failed ^(non-critical^)
echo Done.
echo.

REM -- Step 4: Generate history.json ------------------------
echo [4/5] Generating history.json...
%PYTHON% save_history_json.py
if %errorlevel% neq 0 echo WARNING: save_history_json.py failed ^(non-critical^)
echo Done.
echo.

REM -- Step 5: Push to GitHub -------------------------------
echo [5/5] Pushing to GitHub...
git add dashboard_data.json debtor_analysis_data.json history.json targets.json
git add process_data.py targets_loader.py
git add sales_dashboard.html management.html admin.html admin_context.js
git add accounts.html campaign_audit.html stock.html stock_calendar.html debtor_analysis.html debtor_map.html index.html
git add data_*.json months_index.json 2>nul
git add reports\miracle-2a-sku-strength\index.html reports\miracle-2a-sku-strength\penetration.html reports\miracle-2a-sku-strength\gap_opportunities.html reports\miracle-2a-sku-strength\debtor_status.js reports\miracle-2a-sku-strength\agent_monthly_revenue.js reports\miracle-2a-sku-strength\sku_debtor_history.js reports\miracle-2a-sku-strength\sku_gap_opportunities.js reports\miracle-2a-sku-strength\sku_penetration_data.js reports\miracle-2a-sku-strength\build_report_data.py 2>nul
if "%MONTH_OVERRIDE%"=="" (
    git commit -m "Daily update %date% %time%"
) else (
    git commit -m "Regenerate %MONTH_OVERRIDE% - %date% %time%"
)
git push origin HEAD:main
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
