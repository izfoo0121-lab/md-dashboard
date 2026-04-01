import streamlit as st
import os, json, pandas as pd

# v2026.04.01d — HTML fetches all JSON directly from GitHub raw URLs
# Streamlit only serves HTML shell — no data injection, no size limits

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

def inject_history(html):
    """Only history.xlsx needs server-side injection (not on GitHub)."""
    hp = os.path.join(BASE_DIR, "history.xlsx")
    history_json = "null"
    if os.path.exists(hp):
        try:
            ef = pd.ExcelFile(hp)
            df = pd.read_excel(hp, sheet_name="Monthly_Summary")
            dt = pd.read_excel(hp, sheet_name="Team_Summary") if "Team_Summary" in ef.sheet_names else pd.DataFrame()
            history_json = json.dumps({
                "monthly": json.loads(df.to_json(orient="records", default_handler=str)),
                "team":    json.loads(dt.to_json(orient="records", default_handler=str)) if not dt.empty else [],
            })
        except: pass
    return html.replace("</head>", f"<script>window.HISTORY_DATA={history_json};</script>\n</head>")

def point_to_github(html):
    """Redirect all fetch() calls to GitHub raw URLs."""
    REPO = REPO_RAW
    # Replace with GitHub URL — keep cache buster variable intact
    html = html.replace(
        "'dashboard_data.json' + '?v=' + bust",
        f"'{REPO}/dashboard_data.json' + '?v=' + bust"
    ).replace(
        "fetch('targets.json')",
        f"fetch('{REPO}/targets.json')"
    ).replace(
        "fetch('campaigns.json')",
        f"fetch('{REPO}/campaigns.json')"
    )
    return html

page = st.query_params.get("page", "agent").lower()

if page == "management":
    html = read_file("management.html")
    if html:
        html = point_to_github(html)
        html = inject_history(html)
        st.components.v1.html(html, height=900, scrolling=True)

elif page == "admin":
    html = read_file("admin.html")
    if html:
        html = point_to_github(html)
        st.components.v1.html(html, height=900, scrolling=True)

elif page == "campaigns":
    html = read_file("campaigns.html")
    if html:
        html = point_to_github(html)
        st.components.v1.html(html, height=900, scrolling=True)

else:
    html = read_file("sales_dashboard.html")
    if html:
        html = point_to_github(html)
        st.components.v1.html(html, height=900, scrolling=True)
