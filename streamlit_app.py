import streamlit as st
import json, os, pandas as pd

# v2026.04.01 — serve dashboard_data.json via fetch instead of inline injection

st.set_page_config(
    page_title="Miracle MD Sales Dashboard",
    page_icon="📊", layout="wide",
    initial_sidebar_state="collapsed",
)
st.markdown("""
<style>
  #MainMenu, header, footer { visibility: hidden; }
  .block-container { padding: 0 !important; max-width: 100% !important; }
  iframe { border: none; }
  [data-testid="stSidebarNav"] { display: none; }
</style>""", unsafe_allow_html=True)

BASE_DIR = os.path.dirname(os.path.abspath(__file__))

def read_file(f):
    p = os.path.join(BASE_DIR, f)
    return open(p, encoding='utf-8').read() if os.path.exists(p) else None

def read_json(f):
    p = os.path.join(BASE_DIR, f)
    return json.load(open(p, encoding='utf-8')) if os.path.exists(p) else {}

def get_history_json():
    hp = os.path.join(BASE_DIR, "history.xlsx")
    if not os.path.exists(hp): return "null"
    try:
        ef = pd.ExcelFile(hp)
        df = pd.read_excel(hp, sheet_name="Monthly_Summary")
        dt = pd.read_excel(hp, sheet_name="Team_Summary") if "Team_Summary" in ef.sheet_names else pd.DataFrame()
        return json.dumps({
            "monthly": json.loads(df.to_json(orient="records", default_handler=str)),
            "team":    json.loads(dt.to_json(orient="records", default_handler=str)) if not dt.empty else [],
        })
    except: return "null"

def inject_data(html, include_history=False):
    """Inject data inline — split large JSON into chunks to avoid Streamlit limits."""
    data = read_json("dashboard_data.json")

    # Inject only essential top-level keys inline, defer heavy debtor cards
    # This keeps the inline payload small
    slim = {
        "current_month":       data.get("current_month"),
        "generated_at":        data.get("generated_at"),
        "working_days":        data.get("working_days"),
        "team_summary":        data.get("team_summary"),
        "group_brand_targets": data.get("group_brand_targets"),
        "birthday_campaign":   data.get("birthday_campaign"),
        "brand_campaigns":     data.get("brand_campaigns", []),
    }

    # Per-agent: inject sales/brand/kpi data but slim down debtor_cards
    agents_slim = {}
    for agent, adata in data.get("agents", {}).items():
        dc = adata.get("debtor_cards", {})
        agents_slim[agent] = {
            "sales_progression": adata.get("sales_progression"),
            "brand_commission":  adata.get("brand_commission"),
            "kpi":               adata.get("kpi"),
            "newbie_scheme":     adata.get("newbie_scheme"),
            "aging":             adata.get("aging"),
            "debtor_cards": {
                "total_debtors":    dc.get("total_debtors"),
                "active_count":     dc.get("active_count"),
                "pending_count":    dc.get("pending_count"),
                "reactivation_count": dc.get("reactivation_count"),
                "activation_rate":  dc.get("activation_rate"),
                "activation_base":  dc.get("activation_base"),
                "total_new_sku":    dc.get("total_new_sku"),
                "debtors":          dc.get("debtors", []),  # full debtor list
            }
        }
    slim["agents"] = agents_slim

    data_json = json.dumps(slim, default=str)
    html = html.replace(
        "fetch('dashboard_data.json')",
        f"Promise.resolve({{json:()=>Promise.resolve({data_json})}})"
    )

    if include_history:
        history_json = get_history_json()
        html = html.replace(
            "</head>",
            f"<script>window.HISTORY_DATA={history_json};</script>\n</head>"
        )
    return html

# ── Routing ───────────────────────────────────────────────────────────────────
page = st.query_params.get("page", "agent").lower()

if page == "management":
    html = read_file("management.html")
    if html:
        st.components.v1.html(inject_data(html, include_history=True), height=900, scrolling=True)

elif page == "admin":
    html = read_file("admin.html")
    if html:
        # Inject targets.json for admin
        targets = read_json("targets.json")
        campaigns = read_json("campaigns.json")
        html = html.replace(
            "fetch('targets.json')",
            f"Promise.resolve({{json:()=>Promise.resolve({json.dumps(targets)})}})"
        ).replace(
            "fetch('campaigns.json')",
            f"Promise.resolve({{json:()=>Promise.resolve({json.dumps(campaigns)})}})"
        )
        st.components.v1.html(html, height=900, scrolling=True)

elif page == "campaigns":
    html = read_file("campaigns.html")
    if html:
        campaigns = read_json("campaigns.json")
        data = read_json("dashboard_data.json")
        html = html.replace(
            "fetch('campaigns.json')",
            f"Promise.resolve({{json:()=>Promise.resolve({json.dumps(campaigns)})}})"
        ).replace(
            "fetch('dashboard_data.json')",
            f"Promise.resolve({{json:()=>Promise.resolve({json.dumps(data)})}})"
        )
        st.components.v1.html(html, height=900, scrolling=True)

else:
    html = read_file("sales_dashboard.html")
    if html:
        st.components.v1.html(inject_data(html), height=900, scrolling=True)
