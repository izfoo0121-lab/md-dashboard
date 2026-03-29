import streamlit as st
import json, os, pandas as pd

# v2026.03.29b — fixed routing + persistent history

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
    """Read history.xlsx and return as JSON string."""
    hp = os.path.join(BASE_DIR, "history.xlsx")
    if not os.path.exists(hp):
        return "null"
    try:
        ef  = pd.ExcelFile(hp)
        df  = pd.read_excel(hp, sheet_name="Monthly_Summary")
        dt  = pd.read_excel(hp, sheet_name="Team_Summary") if "Team_Summary" in ef.sheet_names else pd.DataFrame()
        return json.dumps({
            "monthly": json.loads(df.to_json(orient="records", default_handler=str)),
            "team":    json.loads(dt.to_json(orient="records", default_handler=str)) if not dt.empty else [],
        })
    except Exception as e:
        return "null"

def inject_data(html, include_history=False):
    """Inject dashboard_data.json and optionally history into HTML."""
    data      = read_json("dashboard_data.json")
    data_json = json.dumps(data)
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
# Support both ?page= (legacy) and path-based routing
params = st.query_params
page   = params.get("page", "agent").lower()

# Also detect path from URL
try:
    path = st.context.headers.get("X-Forwarded-For", "")
except:
    path = ""

# Determine page from query param
if page == "management":
    html = read_file("management.html")
    if html:
        html = inject_data(html, include_history=True)
        st.components.v1.html(html, height=900, scrolling=True)
    else:
        st.error("management.html not found")

elif page == "admin":
    html = read_file("admin.html")
    if html:
        st.components.v1.html(html, height=900, scrolling=True)
    else:
        st.error("admin.html not found")

elif page == "campaigns":
    html = read_file("campaigns.html")
    if html:
        st.components.v1.html(html, height=900, scrolling=True)
    else:
        st.error("campaigns.html not found")

else:
    # Agent dashboard (default)
    html = read_file("sales_dashboard.html")
    if html:
        html = inject_data(html)
        st.components.v1.html(html, height=900, scrolling=True)
    else:
        st.error("sales_dashboard.html not found")
