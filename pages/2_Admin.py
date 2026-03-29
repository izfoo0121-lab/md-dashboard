import streamlit as st, os

st.set_page_config(page_title="Miracle MD — Admin", page_icon="⚙️", layout="wide", initial_sidebar_state="collapsed")
st.markdown("""
<style>
  #MainMenu, header, footer { visibility: hidden; }
  .block-container { padding: 0 !important; max-width: 100% !important; }
  iframe { border: none; }
  [data-testid="stSidebarNav"] { display: none; }
</style>""", unsafe_allow_html=True)

BASE_DIR = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
admin_path = os.path.join(BASE_DIR, "admin.html")

if not os.path.exists(admin_path):
    st.error(f"admin.html not found at: {admin_path}")
    st.stop()

with open(admin_path, encoding='utf-8') as f:
    html = f.read()

st.components.v1.html(html, height=900, scrolling=True)
