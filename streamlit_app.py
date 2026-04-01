import streamlit as st
import json, os, pandas as pd

# v2026.03.29c

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
    data = read_json("dashboard_data.json")
    html = html.replace(
        "fetch('dashboard_data.json')",
        f"Promise.resolve({{json:()=>Promise.resolve({json.dumps(data)})}})"
    )
    if include_history:
        html = html.replace("</head>", f"<script>window.HISTORY_DATA={get_history_json()};</script>\n</head>")
    return html

# ── Routing via ?page= param ──────────────────────────────────────────────────
page = st.query_params.get("page", "agent").lower()

if page == "management":
    html = read_file("management.html")
    if html:
        st.components.v1.html(inject_data(html, include_history=True), height=900, scrolling=True)

elif page == "admin":
    html = read_file("admin.html")
    if html:
        st.components.v1.html(html, height=900, scrolling=True)

elif page == "campaigns":
    html = read_file("campaigns.html")
    if html:
        st.components.v1.html(html, height=900, scrolling=True)

else:
    html = read_file("sales_dashboard.html")
    if html:
        st.components.v1.html(inject_data(html), height=900, scrolling=True)
