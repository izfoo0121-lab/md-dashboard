"""
digest.py
=========
Builds the daily digest from orders_log, grn_log, transfers_log.
Plain-function module — no bot dependency, easy to test.
"""
from __future__ import annotations
import json
from pathlib import Path
from datetime import datetime, timedelta
from collections import defaultdict


def _load(path: Path) -> list[dict]:
    if not path.exists():
        return []
    try:
        return json.loads(path.read_text(encoding='utf-8'))
    except Exception:
        return []


def _today(now: datetime | None = None) -> str:
    return (now or datetime.now()).strftime('%Y-%m-%d')


def _fmt_qty(n) -> str:
    try:
        n = float(n)
        return str(int(n)) if n == int(n) else f"{n:.1f}"
    except Exception:
        return str(n)


def build_digest(
    data_dir: Path,
    for_date: str | None = None,
    days_pending_threshold: int = 2,
    current_month: str | None = None,
) -> str:
    """Build the end-of-day digest as markdown text.
    
    for_date: YYYY-MM-DD. Defaults to today.
    days_pending_threshold: flag orders with no GRN after N days (default 2).
    current_month: 'YYYY-MM' for rolling month totals (default: current month).
    """
    if for_date is None:
        for_date = _today()
    if current_month is None:
        current_month = datetime.strptime(for_date, '%Y-%m-%d').strftime('%Y-%m')
    
    orders = _load(data_dir / 'orders_log.json')
    grns = _load(data_dir / 'grn_log.json')
    transfers = _load(data_dir / 'transfers_log.json')
    unknown = _load(data_dir / 'unknown_skus.json')
    
    # Filter by date
    orders_today    = [o for o in orders    if o.get('date') == for_date]
    grns_today      = [g for g in grns      if g.get('date') == for_date]
    transfers_today = [t for t in transfers if t.get('date') == for_date]
    
    # ── Format header ─────────────────────────────────────────────
    try:
        d = datetime.strptime(for_date, '%Y-%m-%d')
        header_date = d.strftime('%d %b %Y (%a)')
    except Exception:
        header_date = for_date
    
    out = [f"*🌙 STOCK DIGEST — {header_date}*", "─" * 20]
    
    # ── Orders section ────────────────────────────────────────────
    out.append("")
    out.append("*📥 ORDERS TODAY*")
    
    # Group by company
    orders_by_company: dict[str, list[dict]] = defaultdict(list)
    for o in orders_today:
        orders_by_company[o.get('company', '?')].append(o)
    
    if not orders_today:
        out.append("  _No orders today._")
    else:
        for company in sorted(orders_by_company.keys()):
            company_orders = orders_by_company[company]
            company_total = sum(
                ln['qty'] for o in company_orders for ln in o.get('lines', []) if ln.get('sku')
            )
            out.append(f"*{company}* ({len(company_orders)} orders · {_fmt_qty(company_total)} CTN)")
            for o in company_orders:
                agent = o.get('agent') or '?'
                # Top 4 lines for readability
                line_strs = []
                for ln in o.get('lines', []):
                    if not ln.get('sku'):
                        continue
                    tag = '⁺' if ln.get('amended') else ''
                    line_strs.append(f"{ln['sku']} {_fmt_qty(ln['qty'])}{tag}")
                order_total = sum(ln['qty'] for ln in o.get('lines', []) if ln.get('sku'))
                shown = ', '.join(line_strs[:4])
                more = f" +{len(line_strs)-4} more" if len(line_strs) > 4 else ''
                out.append(f"  • *{agent}* → {shown}{more}  ({_fmt_qty(order_total)})")
    
    # ── GRN section ───────────────────────────────────────────────
    out.append("")
    out.append("─" * 20)
    out.append("*📦 RECEIVED TODAY (来货)*")
    
    grns_by_company: dict[str, list[dict]] = defaultdict(list)
    for g in grns_today:
        grns_by_company[g.get('company', '?')].append(g)
    
    if not grns_today:
        out.append("  _No GRN today._")
    else:
        for company in sorted(grns_by_company.keys()):
            company_grns = grns_by_company[company]
            company_total = sum(
                ln['qty'] for g in company_grns for ln in g.get('lines', []) if ln.get('sku')
            )
            out.append(f"*{company}* ({len(company_grns)} GRN · {_fmt_qty(company_total)} CTN)")
            for g in company_grns:
                agent = g.get('agent') or '?'
                # Try to match to an order from past 3 days
                match_note = _match_grn_to_order(g, orders, days=3)
                line_strs = [f"{ln['sku']} {_fmt_qty(ln['qty'])}" for ln in g.get('lines', []) if ln.get('sku')]
                shown = ', '.join(line_strs[:4])
                more = f" +{len(line_strs)-4}" if len(line_strs) > 4 else ''
                grn_total = sum(ln['qty'] for ln in g.get('lines', []) if ln.get('sku'))
                out.append(f"  • *{agent}* → {shown}{more}  ({_fmt_qty(grn_total)}) {match_note}")
    
    # ── Transfers section ─────────────────────────────────────────
    out.append("")
    out.append("─" * 20)
    out.append(f"*🔄 TRANSFERS TODAY ({len(transfers_today)})*")
    if not transfers_today:
        out.append("  _No transfers today._")
    else:
        # Deduplicate sender/receiver pairs by (from, to, date, sku qty tuples)
        seen = set()
        for t in transfers_today:
            key = (t.get('from_agent'), t.get('to_agent'), t.get('date'),
                   tuple((ln.get('sku'), ln.get('qty')) for ln in t.get('lines', [])))
            if key in seen:
                continue
            seen.add(key)
            lines = ', '.join(
                f"{ln['sku']} {_fmt_qty(ln['qty'])} ctn"
                for ln in t.get('lines', []) if ln.get('sku')
            )
            reason = t.get('reason_text') or ''
            reason_tag = f" · {reason}" if reason else ''
            approved = t.get('approved_by') or ''
            approved_tag = f" · ✓ {approved}" if approved else ''
            out.append(f"  • {t.get('from_agent','?')} → {t.get('to_agent','?')}: {lines}{reason_tag}{approved_tag}")
    
    # ── Attention section ─────────────────────────────────────────
    attention: list[str] = []
    
    # Pending orders (no GRN after threshold days)
    today_dt = datetime.strptime(for_date, '%Y-%m-%d')
    for o in orders:
        try:
            od = datetime.strptime(o.get('date', '1900-01-01'), '%Y-%m-%d')
        except Exception:
            continue
        age = (today_dt - od).days
        if age < days_pending_threshold or age > 14:
            continue
        # Does this agent have any GRN in the [order_date, today] range for same company?
        matched = False
        for g in grns:
            try:
                gd = datetime.strptime(g.get('date', '1900-01-01'), '%Y-%m-%d')
            except Exception:
                continue
            if (g.get('agent') == o.get('agent')
                and g.get('company') == o.get('company')
                and od <= gd <= today_dt):
                matched = True
                break
        if not matched:
            attention.append(
                f"{o.get('agent','?')} ({o.get('company','?')}) ordered {o.get('date')} — no GRN yet ({age} days)"
            )
    
    # Unknown SKUs today
    unknown_today = [u for u in unknown if u.get('logged_at','').startswith(for_date)]
    if unknown_today:
        # Group by raw SKU name
        counts: dict[str, int] = defaultdict(int)
        for u in unknown_today:
            counts[u.get('raw_sku','?')] += 1
        for raw, count in sorted(counts.items(), key=lambda kv: -kv[1]):
            attention.append(f'Unknown SKU: "{raw}" ×{count}')
    
    if attention:
        out.append("")
        out.append("─" * 20)
        out.append("*⚠ ATTENTION*")
        for a in attention:
            out.append(f"  • {a}")
    
    # ── Rolling month totals ──────────────────────────────────────
    month_orders_qty = sum(
        ln['qty']
        for o in orders if (o.get('date') or '').startswith(current_month)
        for ln in o.get('lines', []) if ln.get('sku')
    )
    month_grn_qty = sum(
        ln['qty']
        for g in grns if (g.get('date') or '').startswith(current_month)
        for ln in g.get('lines', []) if ln.get('sku')
    )
    month_transfers = sum(1 for t in transfers if (t.get('date') or '').startswith(current_month))
    gap = month_orders_qty - month_grn_qty
    
    out.append("")
    out.append("─" * 20)
    out.append("*📊 MONTH TO DATE*")
    out.append(f"  Orders: {_fmt_qty(month_orders_qty)} CTN  |  Received: {_fmt_qty(month_grn_qty)} CTN  |  Gap: {_fmt_qty(gap)} CTN")
    out.append(f"  Transfers: {month_transfers}")
    
    return '\n'.join(out)


def _match_grn_to_order(grn: dict, orders: list[dict], days: int = 3) -> str:
    """Return a short tag like '✓ matches 20/4 order' or '⚠ no match'."""
    agent = grn.get('agent')
    company = grn.get('company')
    if not agent or not company:
        return ''
    try:
        gd = datetime.strptime(grn.get('date','1900-01-01'), '%Y-%m-%d')
    except Exception:
        return ''
    # Look back N days for an order by same agent/company
    for delta in range(days + 1):
        check_date = (gd - timedelta(days=delta)).strftime('%Y-%m-%d')
        for o in orders:
            if (o.get('agent') == agent
                and o.get('company') == company
                and o.get('date') == check_date):
                if delta == 0:
                    return '✓ matches same-day order'
                return f"✓ matches {o.get('date')} order"
    return '⚠ no matching order'
