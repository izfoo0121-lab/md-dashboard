import streamlit as st, os
st.set_page_config(page_title="Miracle MD — Admin", page_icon="⚙️", layout="wide", initial_sidebar_state="collapsed")
st.markdown("<style>#MainMenu,header,footer{visibility:hidden}.block-container{padding:0!important;max-width:100%!important}iframe{border:none}[data-testid='stSidebarNav']{display:none}</style>", unsafe_allow_html=True)
BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
f = os.path.join(BASE_DIR,"admin.html")
if os.path.exists(f):
    st.components.v1.html(open(f,encoding='utf-8').read(), height=900, scrolling=True)
