# Deployment Flow

This project currently uses two GitHub repositories:

- `md-dashboard-test` (`origin` in `C:\Users\tgy_3\Desktop\md-dashboard-test`) is the staging/source repo used for development, verification, and daily data generation.
- `md-dashboard` (`production` remote from the test checkout, and `origin` in `C:\Users\tgy_3\Desktop\md-dashboard-prod`) is the production repo served by GitHub Pages.

GitHub Pages for the public dashboard is served from the production repo:

```text
https://izfoo0121-lab.github.io/md-dashboard/
```

In practice, pushing to `md-dashboard` `main` updates the public site. Pushing only to `md-dashboard-test` `main` does not deploy to the public dashboard.

## Current Policy: Manual Promotion

Promotion from test to production is manual. This split is useful only if production remains under explicit control. After a feature lands on test `main`, the author is responsible for promoting the intended files to production.

Do not assume a commit on `md-dashboard-test/main` is live.

## Manual Promotion Checklist

1. Verify test is on `main` and up to date.

   ```powershell
   cd C:\Users\tgy_3\Desktop\md-dashboard-test
   git checkout main
   git pull origin main
   git status
   ```

2. Verify the feature locally or on the test site. For frontend work, hard-refresh the page and check the browser console.

3. Check production before copying files.

   ```powershell
   cd C:\Users\tgy_3\Desktop\md-dashboard-prod
   git status
   git fetch origin
   git log origin/main --oneline -3
   git log refs/heads/main --oneline -1
   ```

4. Copy only the intended files from test to production.

   ```powershell
   $test = "C:\Users\tgy_3\Desktop\md-dashboard-test"
   $prod = "C:\Users\tgy_3\Desktop\md-dashboard-prod"
   cd $prod

   Copy-Item "$test\sales_dashboard.html" "$prod\sales_dashboard.html"
   # Add other intended files explicitly.
   ```

5. Review the production diff before committing.

   ```powershell
   git status
   git diff --stat
   ```

6. Commit and push production.

   ```powershell
   git add <files>
   git commit -m "promote: short description"
   git push origin main
   ```

7. Verify the public GitHub Pages HTML with a cache buster.

   ```powershell
   $ts = ([DateTimeOffset]::UtcNow).ToUnixTimeSeconds()
   (Invoke-WebRequest "https://izfoo0121-lab.github.io/md-dashboard/management.html?v=$ts" -UseBasicParsing).Content |
     Select-String "expected-marker"
   ```

   GitHub Pages CDN can lag briefly. If the first check misses, wait 1-2 minutes and retry.

## File Promotion Rules

- Frontend-only changes usually copy only the changed `.html` file.
- Data refreshes usually copy only the regenerated JSON files that were intentionally promoted.
- Do not copy `targets.json` unless the task explicitly says to promote target config.
- Do not copy `history.json` from test unless it is confirmed to be the canonical history source.
- Do not force-push production. Rollbacks should be normal revert commits.

## Automation Option

Automatic promotion from `md-dashboard-test/main` to `md-dashboard/main` would require a GitHub Actions secret with write access to the production repo, for example `PRODUCTION_REPO_TOKEN`.

Recommended workflow if automation is desired later:

1. Add CI checks for generated HTML/JS syntax and any data validation scripts.
2. Add a protected environment named `production`.
3. Add a manually triggered `workflow_dispatch` action that:
   - checks out `md-dashboard-test/main`,
   - copies an explicit allowlist of files,
   - commits to `izfoo0121-lab/md-dashboard`,
   - pushes to production `main`.
4. Require human approval on the `production` environment.

Until that token and approval flow exist, manual promotion is the source of truth.
