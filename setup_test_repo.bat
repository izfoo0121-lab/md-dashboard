@echo off
echo ============================================
echo  MIRACLE MD Dashboard - Test Repo Setup
echo ============================================
echo.

REM Step 1: Create test branch locally
cd /d C:\Users\tgy_3\Desktop\md-dashboard
git checkout -b dev 2>nul || git checkout dev

echo [1] Switched to dev branch
echo.

REM Step 2: Push dev branch to GitHub
git push origin dev

echo [2] Dev branch pushed to GitHub
echo.

echo ============================================
echo  NEXT STEPS (do manually on GitHub.com):
echo ============================================
echo.
echo 1. Go to: https://github.com/izfoo0121-lab/md-dashboard
echo 2. Settings ^> Pages ^> Source: Deploy from branch
echo 3. Branch: dev  /  Folder: / (root) ^> Save
echo.
echo TEST URL will be:
echo https://izfoo0121-lab.github.io/md-dashboard/
echo (same URL, but you switch branch to test)
echo.
echo BETTER: Create separate test repo
echo 1. Go to github.com/new
echo 2. Name: md-dashboard-test
echo 3. Public, no readme
echo 4. Run: git remote add test https://github.com/izfoo0121-lab/md-dashboard-test.git
echo 5. Run: git push test dev:main
echo 6. Enable GitHub Pages on md-dashboard-test
echo.
echo TEST URL: https://izfoo0121-lab.github.io/md-dashboard-test/
echo ============================================
pause
