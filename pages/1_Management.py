import streamlit as st
import json, os, pandas as pd

st.set_page_config(
    page_title="Miracle MD — Management",
    page_icon="📊", layout="wide",
    initial_sidebar_state="collapsed"
)
st.markdown("""
<style>
  #MainMenu, header, footer { visibility: hidden; }
  .block-container { padding: 0 !important; max-width: 100% !important; }
  iframe { border: none; }
  [data-testid="stSidebarNav"] { display: none; }
</style>""", unsafe_allow_html=True)

# BASE_DIR = folder containing the pages/ subfolder = md-dashboard root
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

# Verify we're pointing at the right folder
mgmt_path = os.path.join(BASE_DIR, "management.html")
if not os.path.exists(mgmt_path):
    st.error(f"management.html not found at: {mgmt_path}")
    st.stop()

# Read management.html
with open(mgmt_path, encoding='utf-8') as f:
    html = f.read()

# Inject dashboard_data.json
data_path = os.path.join(BASE_DIR, "dashboard_data.json")
if os.path.exists(data_path):
    with open(data_path, encoding='utf-8') as f:
        data = json.load(f)
    html = html.replace(
        "fetch('dashboard_data.json')",
        f"Promise.resolve({{json:()=>Promise.resolve({json.dumps(data)})}})"
    )

# Inject history.xlsx
history_json = "null"
hp = os.path.join(BASE_DIR, "history.xlsx")
if os.path.exists(hp):
    try:
        ef  = pd.ExcelFile(hp)
        df  = pd.read_excel(hp, sheet_name="Monthly_Summary")
        dt  = pd.read_excel(hp, sheet_name="Team_Summary") if "Team_Summary" in ef.sheet_names else pd.DataFrame()
        history_json = json.dumps({
            "monthly": json.loads(df.to_json(orient="records", default_handler=str)),
            "team":    json.loads(dt.to_json(orient="records", default_handler=str)) if not dt.empty else [],
        })
    except Exception as e:
        st.warning(f"Could not load history: {e}")

html = html.replace("</head>", f"<script>window.HISTORY_DATA={history_json};</script>\n</head>")

st.components.v1.html(html, height=900, scrolling=True)
