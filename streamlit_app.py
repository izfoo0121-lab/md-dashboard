import streamlit as st
import streamlit.components.v1 as components
import os, json, pandas as pd

# v2026.04.02c — inject slim data + lazy load debtors from GitHub per agent

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
REPO_RAW = "https://raw.githubusercontent.com/izfoo0121-lab/md-dashboard/main"

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

def build_slim(data, include_debtors=False):
    slim = {
        "current_month":       data.get("current_month"),
        "generated_at":        data.get("generated_at"),
        "working_days":        data.get("working_days"),
        "team_summary":        data.get("team_summary"),
        "group_brand_targets": data.get("group_brand_targets"),
        "birthday_campaign":   data.get("birthday_campaign"),
        "brand_campaigns":     data.get("brand_campaigns", []),
        "agents": {}
    }
    for agent, adata in data.get("agents", {}).items():
        dc = adata.get("debtor_cards", {})
        ag = adata.get("aging", {})
        slim["agents"][agent] = {
            "sales_progression": adata.get("sales_progression"),
            "brand_commission":  adata.get("brand_commission"),
            "kpi":               adata.get("kpi"),
            "newbie_scheme":     adata.get("newbie_scheme"),
            "aging": {k:v for k,v in ag.items() if k != "all_unpaid_invoices"},
            "debtor_cards": {k:v for k,v in dc.items() if k != "debtors"},
        }
        slim["agents"][agent]["debtor_cards"]["debtors"] = \
            dc.get("debtors", []) if include_debtors else []
    return slim

def inject(html, data, include_debtors=False, include_history=False):
    slim = build_slim(data, include_debtors)
    data_json = json.dumps(slim, default=str)

    # Get cache buster from file mtime
    try:
        mtime = int(os.path.getmtime(os.path.join(BASE_DIR, "dashboard_data.json")))
    except:
        mtime = 1

    html = html.replace(
        "fetch('dashboard_data.json')",
        f"Promise.resolve({{json:()=>Promise.resolve({data_json})}})"
    ).replace(
        "fetch('targets.json')",
        f"fetch('{REPO_RAW}/targets.json?v={mtime}')"
    ).replace(
        "fetch('campaigns.json')",
        f"fetch('{REPO_RAW}/campaigns.json?v={mtime}')"
    )

    # Inject REPO_RAW and mtime so JS can lazy-load debtors
    script = f"""<script>
window.REPO_RAW = '{REPO_RAW}';
window.CACHE_V = '{mtime}';
</script>"""
    html = html.replace("</head>", script + "\n</head>")

    if include_history:
        html = html.replace("</head>",
            f"<script>window.HISTORY_DATA={get_history_json()};</script>\n</head>")
    return html

page = st.query_params.get("page", "agent").lower()
data = read_json("dashboard_data.json")

if page == "management":
    html = read_file("management.html")
    if html:
        st.components.v1.html(
            inject(html, data, include_debtors=True, include_history=True),
            height=900, scrolling=True
        )
elif page == "admin":
    html = read_file("admin.html")
    if html:
        targets = read_json("targets.json")
        html = html.replace("fetch('targets.json')",
            f"Promise.resolve({{json:()=>Promise.resolve({json.dumps(targets)})}})")
        st.components.v1.html(html, height=900, scrolling=True)
elif page == "campaigns":
    html = read_file("campaigns.html")
    if html:
        campaigns = read_json("campaigns.json")
        html = html.replace("fetch('campaigns.json')",
            f"Promise.resolve({{json:()=>Promise.resolve({json.dumps(campaigns)})}})")
        try:
            mtime = int(os.path.getmtime(os.path.join(BASE_DIR, "dashboard_data.json")))
        except: mtime = 1
        html = html.replace("fetch('dashboard_data.json')",
            f"fetch('{REPO_RAW}/dashboard_data.json?v={mtime}')")
        st.components.v1.html(html, height=900, scrolling=True)
else:
    html = read_file("sales_dashboard.html")
    if html:
        st.components.v1.html(
            inject(html, data, include_debtors=False),
            height=900, scrolling=True
        )
