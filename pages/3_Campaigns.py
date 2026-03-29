import streamlit as st, os

st.set_page_config(page_title="Miracle MD — Campaigns", page_icon="📢", layout="wide", initial_sidebar_state="collapsed")
st.markdown("""
<style>
  #MainMenu, header, footer { visibility: hidden; }
  .block-container { padding: 0 !important; max-width: 100% !important; }
  iframe { border: none; }
  [data-testid="stSidebarNav"] { display: none; }
</style>""", unsafe_allow_html=True)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
camp_path = os.path.join(BASE_DIR, "campaigns.html")

if not os.path.exists(camp_path):
    st.error(f"campaigns.html not found at: {camp_path}")
    st.stop()

with open(camp_path, encoding='utf-8') as f:
    html = f.read()

st.components.v1.html(html, height=900, scrolling=True)
