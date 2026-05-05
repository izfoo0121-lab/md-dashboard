## Deployment Checklist

- [ ] Merged/tested on `md-dashboard-test/main`.
- [ ] Confirmed whether this change needs production promotion.
- [ ] If production promotion is needed, copied only the intended files to `md-dashboard-prod`.
- [ ] Checked production `git diff --stat` before committing.
- [ ] Pushed production `main`.
- [ ] Verified the public GitHub Pages page with a cache-busting URL.

See [DEPLOYMENT.md](../DEPLOYMENT.md) for the full test-to-production flow.
