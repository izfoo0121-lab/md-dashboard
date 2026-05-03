import json
import urllib.parse
import urllib.request
from collections import defaultdict


SUPABASE_URL = "https://rqitgmydcbyiygqjssrb.supabase.co"
SUPABASE_KEY = "sb_publishable_8xb7ZaHyr3OF3WNEqufuDg_67spOIFw"
PAGE_SIZE = 1000


def fetch_all(path):
    rows = []
    page = 0
    while True:
        start = page * PAGE_SIZE
        end = start + PAGE_SIZE - 1
        req = urllib.request.Request(
            f"{SUPABASE_URL}/rest/v1/{path}",
            headers={
                "apikey": SUPABASE_KEY,
                "Authorization": f"Bearer {SUPABASE_KEY}",
                "Range-Unit": "items",
                "Range": f"{start}-{end}",
                "Prefer": "count=none",
            },
        )
        with urllib.request.urlopen(req, timeout=60) as resp:
            chunk = json.loads(resp.read().decode("utf-8"))
        if not chunk:
            break
        rows.extend(chunk)
        if len(chunk) < PAGE_SIZE:
            break
        page += 1
    return rows


def parse_rule_notes(notes):
    if not notes:
        return {}
    if isinstance(notes, dict):
        return notes
    try:
        parsed = json.loads(notes)
        return parsed if isinstance(parsed, dict) else {"notes": notes}
    except Exception:
        return {"notes": notes}


def rule_from_db(row):
    extra = parse_rule_notes(row.get("notes"))
    rule = {
        "promo": row.get("promo_detail") or "",
        "promo_detail": row.get("promo_detail") or "",
        "min_ctn": row.get("min_order_ctn") if row.get("min_order_ctn") is not None else "",
        "min_order_ctn": row.get("min_order_ctn"),
        "foc_item": row.get("foc_item") or "",
        "foc_qty": row.get("foc_qty") if row.get("foc_qty") is not None else "",
        "foc_unit": row.get("foc_unit") or "",
        "foc_type": row.get("foc_type") or "",
        "cap": row.get("cap"),
        "target_pct": row.get("target_pct"),
        "target_label": row.get("target_label") or "",
    }
    rule.update(extra)
    return rule


def campaign_from_db(row, rules_by_campaign, debtors_by_campaign):
    brands = row.get("brands") if isinstance(row.get("brands"), list) else ([row.get("brands")] if row.get("brands") else [])
    cat_rules = {}
    for rule in rules_by_campaign.get(row.get("id"), []):
        if rule.get("cat_group"):
            cat_rules[rule["cat_group"]] = rule_from_db(rule)
    debtors = []
    for d in debtors_by_campaign.get(row.get("id"), []):
        debtors.append({
            "code": d.get("debtor_code") or "",
            "debtor_code": d.get("debtor_code") or "",
            "name": d.get("debtor_name") or "",
            "debtor_name": d.get("debtor_name") or "",
            "agent": d.get("agent") or "",
            "cat": d.get("cat") or "",
            "cat_group": d.get("cat_group") or "",
            "debtor_type": d.get("debtor_type") or "",
            "foc_item": d.get("foc_item") or "",
            "foc_qty": d.get("foc_qty") if d.get("foc_qty") is not None else "",
            "foc_unit": d.get("foc_unit") or "",
            "foc_type": d.get("foc_type") or "",
            "rebate": d.get("rebate"),
            "foc_item2": d.get("foc_item_2") or "",
            "foc_qty2": d.get("foc_qty_2") if d.get("foc_qty_2") is not None else "",
            "foc_item_2": d.get("foc_item_2") or "",
            "foc_qty_2": d.get("foc_qty_2") if d.get("foc_qty_2") is not None else "",
            "foc_unit_2": d.get("foc_unit_2") or "",
            "avg_ctn": d.get("avg_ctn"),
            "promo_logic": d.get("promo_logic") or "",
            "approval": bool(d.get("approval")),
            "approval_note": d.get("approval_note") or "",
            "notes": d.get("notes") or "",
        })
    return {
        "id": row.get("id"),
        "name": row.get("name") or "",
        "type": row.get("type") or "other",
        "brand": brands[0] if len(brands) == 1 else "",
        "brands": brands,
        "description": row.get("description") or "",
        "notes": row.get("notes"),
        "promo_detail": row.get("promo_detail") or "",
        "min_order_ctn": row.get("min_order_ctn"),
        "cat_rules": cat_rules,
        "default_foc_item": row.get("default_foc_item") or "",
        "default_foc_qty": row.get("default_foc_qty") if row.get("default_foc_qty") is not None else "",
        "default_foc_unit": row.get("default_foc_unit") or "",
        "default_foc_type": row.get("default_foc_type") or "",
        "default_foc_item_2": row.get("default_foc_item_2") or "",
        "default_foc_qty_2": row.get("default_foc_qty_2") if row.get("default_foc_qty_2") is not None else "",
        "default_foc_unit_2": row.get("default_foc_unit_2") or "",
        "foc_note": row.get("foc_note") or "",
        "festive_occasion": row.get("festive_occasion") or "",
        "conditions": row.get("conditions") if isinstance(row.get("conditions"), list) else [],
        "no_cap": bool(row.get("no_cap")),
        "active": row.get("active") is not False,
        "start_date": row.get("start_date"),
        "deadline": row.get("deadline") or "",
        "created_at": row.get("created_at") or "",
        "updated_at": row.get("updated_at") or "",
        "debtors": debtors,
    }


def main():
    campaigns = fetch_all("campaigns?select=*&order=created_at.asc")
    rules = fetch_all("campaign_cat_rules?select=*")
    debtors = fetch_all("campaign_debtors?select=*&order=debtor_code.asc")

    rules_by_campaign = defaultdict(list)
    for row in rules:
        rules_by_campaign[row.get("campaign_id")].append(row)

    debtors_by_campaign = defaultdict(list)
    for row in debtors:
        debtors_by_campaign[row.get("campaign_id")].append(row)

    data = {
        "campaigns": [
            campaign_from_db(row, rules_by_campaign, debtors_by_campaign)
            for row in campaigns
        ]
    }
    with open("campaigns.json", "w", encoding="utf-8") as f:
        json.dump(data, f, ensure_ascii=False, separators=(",", ":"))
    print(f"Wrote campaigns.json: {len(campaigns)} campaigns, {len(debtors)} debtors, {len(rules)} cat rules")


if __name__ == "__main__":
    main()
