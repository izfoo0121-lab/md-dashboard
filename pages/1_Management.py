import streamlit as st, json, os, pandas as pd

st.set_page_config(page_title="Miracle MD — Management", page_icon="📊", layout="wide", initial_sidebar_state="collapsed")
st.markdown("<style>#MainMenu,header,footer{visibility:hidden}.block-container{padding:0!important;max-width:100%!important}iframe{border:none}[data-testid='stSidebarNav']{display:none}</style>", unsafe_allow_html=True)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def rf(f): return open(os.path.join(BASE_DIR,f),encoding='utf-8').read() if os.path.exists(os.path.join(BASE_DIR,f)) else None
def rj(f): return json.load(open(os.path.join(BASE_DIR,f),encoding='utf-8')) if os.path.exists(os.path.join(BASE_DIR,f)) else {}

html = rf("management.html")
if html:
    data = rj("dashboard_data.json")
    html = html.replace("fetch('dashboard_data.json')", f"Promise.resolve({{json:()=>Promise.resolve({json.dumps(data)})}})")
    
    hp = os.path.join(BASE_DIR, "history.xlsx")
    hj = "null"
    if os.path.exists(hp):
        try:
            ef = pd.ExcelFile(hp)
            df = pd.read_excel(hp, sheet_name="Monthly_Summary")
            dt = pd.read_excel(hp, sheet_name="Team_Summary") if "Team_Summary" in ef.sheet_names else pd.DataFrame()
            hj = json.dumps({"monthly": json.loads(df.to_json(orient="records", default_handler=str)),
                             "team": json.loads(dt.to_json(orient="records", default_handler=str)) if not dt.empty else []})
        except: pass
    
    html = html.replace("</head>", f"<script>window.HISTORY_DATA={hj};</script>\n</head>")
    st.components.v1.html(html, height=900, scrolling=True)
