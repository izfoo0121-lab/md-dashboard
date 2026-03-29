import streamlit as st
import json, os, pandas as pd

st.set_page_config(page_title="Miracle MD — Management", page_icon="📊", layout="wide", initial_sidebar_state="collapsed")
st.markdown("<style>#MainMenu,header,footer{visibility:hidden}.block-container{padding:0!important;max-width:100%!important}iframe{border:none}</style>", unsafe_allow_html=True)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))

def read_file(f): 
    p = os.path.join(BASE_DIR, f)
    return open(p, encoding='utf-8').read() if os.path.exists(p) else None

def read_json(f):
    p = os.path.join(BASE_DIR, f)
    return json.load(open(p, encoding='utf-8')) if os.path.exists(p) else {}

html = read_file("management.html")
if html:
    data = read_json("dashboard_data.json")
    html = html.replace("fetch('dashboard_data.json')", f"Promise.resolve({{json:()=>Promise.resolve({json.dumps(data)})}})")
    
    history_json = "null"
    hp = os.path.join(BASE_DIR, "history.xlsx")
    if os.path.exists(hp):
        try:
            df = pd.read_excel(hp, sheet_name="Monthly_Summary")
            ef = pd.ExcelFile(hp)
            dt = pd.read_excel(hp, sheet_name="Team_Summary") if "Team_Summary" in ef.sheet_names else pd.DataFrame()
            history_json = json.dumps({"monthly": json.loads(df.to_json(orient="records", default_handler=str)),
                                       "team": json.loads(dt.to_json(orient="records", default_handler=str)) if not dt.empty else []})
        except: pass
    
    html = html.replace("</head>", f"<script>window.HISTORY_DATA={history_json};</script>\n</head>")
    st.components.v1.html(html, height=900, scrolling=True)
