import streamlit as st
import os

st.set_page_config(page_title="Miracle MD — Campaigns", page_icon="📢", layout="wide", initial_sidebar_state="collapsed")
st.markdown("<style>#MainMenu,header,footer{visibility:hidden}.block-container{padding:0!important;max-width:100%!important}iframe{border:none}</style>", unsafe_allow_html=True)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
html = open(os.path.join(BASE_DIR, "campaigns.html"), encoding='utf-8').read() if os.path.exists(os.path.join(BASE_DIR, "campaigns.html")) else None
if html:
    st.components.v1.html(html, height=900, scrolling=True)
