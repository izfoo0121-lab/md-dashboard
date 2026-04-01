import streamlit as st
import streamlit.components.v1 as components
import os, json, pandas as pd

# v2026.04.02 — use st.html() instead of deprecated st.components.v1.html()

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

def point_to_github(html):
    bust = "?v=" + str(os.path.getmtime(os.path.join(BASE_DIR, "dashboard_data.json")))[:10]
    html = html.replace(
        "fetch('dashboard_data.json')",
        f"fetch('{REPO_RAW}/dashboard_data.json{bust}')"
    ).replace(
        "fetch('targets.json')",
        f"fetch('{REPO_RAW}/targets.json')"
    ).replace(
        "fetch('campaigns.json')",
        f"fetch('{REPO_RAW}/campaigns.json')"
    )
    return html

def serve(html, height=900):
    """Use st.html if available, fall back to components.v1.html"""
    try:
        # New Streamlit API
        st.html(html)
    except AttributeError:
        # Fallback for older versions
        components.html(html, height=height, scrolling=True)

page = st.query_params.get("page", "agent").lower()

if page == "management":
    html = read_file("management.html")
    if html:
        html = point_to_github(html)
        html = html.replace("</head>", f"<script>window.HISTORY_DATA={get_history_json()};</script>\n</head>")
        serve(html)

elif page == "admin":
    html = read_file("admin.html")
    if html:
        html = point_to_github(html)
        serve(html)

elif page == "campaigns":
    html = read_file("campaigns.html")
    if html:
        html = point_to_github(html)
        serve(html)

else:
    html = read_file("sales_dashboard.html")
    if html:
        html = point_to_github(html)
        serve(html)
