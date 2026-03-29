import streamlit as st
import json
import os

# ── Page config ───────────────────────────────────────────────────────────
st.set_page_config(
    page_title="Touro MD Sales Dashboard",
    page_icon="📊",
    layout="wide",
    initial_sidebar_state="collapsed",
)

# ── Hide Streamlit chrome ─────────────────────────────────────────────────
st.markdown("""
<style>
  #MainMenu, header, footer { visibility: hidden; }
  .block-container { padding: 0 !important; max-width: 100% !important; }
  iframe { border: none; }
</style>
""", unsafe_allow_html=True)

# ── File paths ────────────────────────────────────────────────────────────
BASE_DIR = os.path.dirname(os.path.abspath(__file__))

def read_file(filename):
    path = os.path.join(BASE_DIR, filename)
    if not os.path.exists(path):
        return None
    with open(path, "r", encoding="utf-8") as f:
        return f.read()

def read_json(filename):
    path = os.path.join(BASE_DIR, filename)
    if not os.path.exists(path):
        return {}
    with open(path, "r", encoding="utf-8") as f:
        return json.load(f)

# ── Query params for routing ──────────────────────────────────────────────
params = st.query_params
page = params.get("page", "agent")  # agent | management | admin

# ── Route to correct page ─────────────────────────────────────────────────
if page == "management":
    html_content = read_file("management.html")
    if html_content is None:
        st.error("management.html not found in dashboard folder.")
    else:
        # Inject dashboard_data.json inline so management.html can load it
        data = read_json("dashboard_data.json")
        data_json = json.dumps(data)
        html_content = html_content.replace(
            "fetch('dashboard_data.json')",
            f"Promise.resolve({{ json: () => Promise.resolve({data_json}) }})"
        )
        st.components.v1.html(html_content, height=900, scrolling=True)

elif page == "admin":
    html_content = read_file("admin.html")
    if html_content is None:
        st.error("admin.html not found in dashboard folder.")
    else:
        st.components.v1.html(html_content, height=900, scrolling=True)

else:
    # Default: agent dashboard
    html_content = read_file("sales_dashboard.html")
    if html_content is None:
        st.error("sales_dashboard.html not found in dashboard folder.")
    else:
        # Inject dashboard_data.json inline
        data = read_json("dashboard_data.json")
        data_json = json.dumps(data)
        html_content = html_content.replace(
            "fetch('dashboard_data.json')",
            f"Promise.resolve({{ json: () => Promise.resolve({data_json}) }})"
        )
        st.components.v1.html(html_content, height=900, scrolling=True)

# ── Navigation links (hidden but functional) ──────────────────────────────
st.markdown("""
<div style="position:fixed;bottom:0;right:0;padding:4px 8px;background:rgba(0,0,0,.4);border-radius:6px 0 0 0;z-index:9999;">
  <a href="?page=agent" style="color:#888;font-size:9px;margin-right:6px;text-decoration:none;">Agent</a>
  <a href="?page=management" style="color:#888;font-size:9px;margin-right:6px;text-decoration:none;">Mgmt</a>
  <a href="?page=admin" style="color:#888;font-size:9px;text-decoration:none;">Admin</a>
</div>
""", unsafe_allow_html=True)
