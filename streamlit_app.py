import streamlit as st
import json
import os
from pathlib import Path

st.set_page_config(
    page_title="MD Sales Dashboard",
    page_icon="📊",
    layout="wide",
    initial_sidebar_state="collapsed"
)

# ── Load data ──────────────────────────────────────────────────────────────────
DATA_FILE = Path(__file__).parent / "dashboard_data.json"

@st.cache_data(ttl=300)  # cache 5 mins
def load_data():
    if not DATA_FILE.exists():
        return None
    with open(DATA_FILE, "r", encoding="utf-8") as f:
        return json.load(f)

RAW = load_data()

# ── Inject full HTML dashboard ─────────────────────────────────────────────────
HTML_FILE = Path(__file__).parent / "sales_dashboard.html"

if RAW is None:
    st.error("⚠️ dashboard_data.json not found. Please run process_data.py first.")
    st.stop()

# Read the HTML dashboard
if not HTML_FILE.exists():
    st.error("⚠️ sales_dashboard.html not found in the same folder.")
    st.stop()

with open(HTML_FILE, "r", encoding="utf-8") as f:
    html_content = f.read()

# Inject the JSON data directly into the HTML so agents don't need to load a file
json_str = json.dumps(RAW, ensure_ascii=False)

# Replace the load screen with auto-loaded data
injected_html = html_content.replace(
    "let RAW = null, jsonFile = null;",
    f"let RAW = {json_str}; let jsonFile = null; let _autoLoaded = true;"
).replace(
    "showScreen('load');",
    """
if(_autoLoaded && RAW) {
    initDashboard();
} else {
    showScreen('load');
}
"""
)

# Display fullscreen
st.components.v1.html(injected_html, height=900, scrolling=True)

# Footer
st.markdown(
    f"<div style='text-align:center;font-size:11px;color:#475569;padding:8px'>Updated: {RAW.get('generatedAt','—')}</div>",
    unsafe_allow_html=True
)
