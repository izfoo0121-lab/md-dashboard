@echo off
set PYTHONIOENCODING=utf-8
echo ============================================
echo  MIRACLE MD DASHBOARD - Daily Update
echo ============================================
echo.

REM -- Usage ------------------------------------------------
REM Normal daily:              update_dashboard.bat
REM Fast (reuse sales cache):  update_dashboard.bat fast
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
echo Checking for pre-staged files...
git diff --cached --quiet
if errorlevel 1 (
    echo ERROR: Pre-staged files detected. Commit or unstage them before the daily update.
    echo        This prevents unrelated work from being included in the generated-data commit.
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
    echo        Local ahead count: %LOCAL_AHEAD%, GitHub ahead count: %LOCAL_BEHIND%.
    echo        No data was regenerated, so GitHub main is protected from stale pushes.
    pause & exit /b 1
)
if not "%LOCAL_BEHIND%"=="0" (
    echo Auto-pulling latest GitHub main. Behind count: %LOCAL_BEHIND%.
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

REM -- Step 0b: Resolve input workbooks ---------------------
echo [0b/5] Resolving source workbooks...
if not defined MD_SALES_FILE set "MD_SALES_FILE=%CD%\MD Sales Report.xlsx"
if not defined MD_DEBTOR_FILE set "MD_DEBTOR_FILE=%CD%\Debtor Maintenance.xlsx"
if not exist "%MD_SALES_FILE%" (
    echo ERROR: Sales source not found: %MD_SALES_FILE%
    pause & exit /b 1
)
if not exist "%MD_DEBTOR_FILE%" (
    echo ERROR: Debtor source not found: %MD_DEBTOR_FILE%
    pause & exit /b 1
)
echo Using sales source:  %MD_SALES_FILE%
echo Using debtor source: %MD_DEBTOR_FILE%
echo Done.
echo.

REM -- Step 1: Process data ---------------------------------
if "%MONTH_OVERRIDE%"=="" (
    if "%FAST_FLAG%"=="" (
        echo [1/5] Processing sales data ^(current month^)...
        %PYTHON% process_data.py
    ) else (
        echo [1/5] Processing sales data ^(FAST mode - validated sales cache^)...
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

REM -- Step 5a: Smoke tests --------------------------------
echo [5a/5] Running smoke tests...
%PYTHON% -m unittest discover -s tests -p "test_*.py"
if %errorlevel% neq 0 (
    echo ERROR: Python smoke tests failed. Nothing was committed or pushed.
    pause & exit /b 1
)
where node >nul 2>&1
if %errorlevel% neq 0 (
    echo ERROR: Node.js not found, cannot run dashboard smoke tests.
    pause & exit /b 1
)
node tests\sales_dashboard_version.test.cjs
if %errorlevel% neq 0 (
    echo ERROR: sales dashboard version smoke test failed.
    pause & exit /b 1
)
node tests\admin_group2a_scope.test.cjs
if %errorlevel% neq 0 (
    echo ERROR: admin group2a scope smoke test failed.
    pause & exit /b 1
)
node tests\sales_new_sku_item_chips.test.cjs
if %errorlevel% neq 0 (
    echo ERROR: New SKU item chip smoke test failed.
    pause & exit /b 1
)
node tests\sku_reports_converter.test.cjs
if %errorlevel% neq 0 (
    echo ERROR: Converter SKU report smoke test failed.
    pause & exit /b 1
)
echo Done.
echo.

REM -- Step 5: Push to GitHub -------------------------------
echo [5/5] Pushing to GitHub...
REM Daily runs publish generated artifacts only. Source/UI edits are committed
REM separately so unrelated local work cannot be swept into a data refresh.
git add dashboard_data.json debtor_analysis_data.json history.json dashboard_version.json
git add data_*.json months_index.json 2>nul
git add reports\miracle-2a-sku-strength\index.html reports\miracle-2a-sku-strength\debtor_status.js reports\miracle-2a-sku-strength\agent_monthly_revenue.js reports\miracle-2a-sku-strength\sku_debtor_history.js reports\miracle-2a-sku-strength\sku_gap_opportunities.js reports\miracle-2a-sku-strength\sku_penetration_data.js 2>nul
git diff --cached --quiet
if %errorlevel%==0 (
    echo No staged dashboard changes to commit.
    goto SUCCESS
)
if "%MONTH_OVERRIDE%"=="" (
    git commit -m "Daily update %date% %time%"
) else (
    git commit -m "Regenerate %MONTH_OVERRIDE% - %date% %time%"
)
if %errorlevel% neq 0 (
    echo ERROR: Git commit failed!
    pause & exit /b 1
)
git push origin HEAD:main
if %errorlevel% neq 0 (
    echo ERROR: Git push failed!
    pause & exit /b 1
)
:SUCCESS
echo Done.
echo.

echo ============================================
if "%MONTH_OVERRIDE%"=="" (echo  Dashboard updated!) else (echo  %MONTH_OVERRIDE% regenerated!)
if not "%FAST_FLAG%"=="" echo  ^(Fast mode - validated sales cache^)
echo ============================================
echo.
echo  Agent:      https://izfoo0121-lab.github.io/md-dashboard
echo  Management: https://izfoo0121-lab.github.io/md-dashboard/management.html
echo  Admin:      https://izfoo0121-lab.github.io/md-dashboard/admin.html
echo  Campaigns:  https://izfoo0121-lab.github.io/md-dashboard/campaigns.html
echo.
pause
