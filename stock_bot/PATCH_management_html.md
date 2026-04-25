# 🔗 Optional: Add Stock Link to management.html

To add a "Stock" button to your existing management.html, find the header row
where you already have "← Overview" / "📊 Analytics" navigation, and add:

```html
<a href="stock.html" 
   style="background:rgba(255,255,255,.1);border:none;color:#fff;font-family:var(--mono);
          font-size:9px;padding:5px 10px;border-radius:8px;cursor:pointer;
          text-decoration:none;display:inline-block;">
  📦 Stock
</a>
```

This single line adds a link to the new stock dashboard without touching any
other part of the file.

If you want it in multiple places (overview, analytics, yearly views),
just paste the same anchor into each view's header row.

---

## Recommended Placement

In `management.html`, inside the `<div class="mgmt-header">` of each view
(overview-view, analytics-view, yearly-view), next to the existing nav buttons.

Search for: `<div class="header-row">` in management.html

Then inside, near the buttons, add the stock link.
