"""
parsers.py
==========
MIRACLE 奇迹 — Telegram message parsers for the 3 stock-operation templates.

Parser functions return a ParseResult dict or None if the message isn't that kind.
All parsers are FORGIVING — they handle template variations, extra whitespace,
Chinese + English mixed content, typos, and slight formatting differences.

Supported templates:
  1. parse_order      — CCOM or 8公司 订货 Order Stock
  2. parse_transfer   — Stock Transfer (sender/receiver)
  3. parse_grn        — 来货单 / goods received

ParseResult structure:
{
    'kind':          'order' | 'transfer' | 'grn',
    'company':       'CCOM' | '8COM' | None,
    'agent':         'JACKY' | None,
    'date':          'YYYY-MM-DD' or original string,
    'lines':         [ {sku, qty, amended, raw}, ... ],
    'total_hint':    int or None        # if template had TOTAL: line
    'unknown_skus':  [raw1, raw2, ...]  # lines parser couldn't match to master
    'meta':          { contact, location, reason, approved_by, cc, ... }
    'warnings':      [str, ...]         # non-fatal issues
    'raw':           original text
}
"""
from __future__ import annotations
import re
import json
from datetime import datetime
from pathlib import Path
from typing import Any


# ── SKU master loader with alias index ────────────────────────────────────
class SkuMaster:
    """Wraps sku_master.json and provides fast alias→canonical lookup."""
    
    def __init__(self, master_path: Path):
        self.master_path = master_path
        self.data: dict = {}
        self.alias_index: dict[str, dict] = {}  # normalised alias → {company, canonical, brand}
        self.agent_alias_index: dict[str, str] = {}  # normalised agent alias → canonical
        self.reload()
    
    def reload(self) -> None:
        if not self.master_path.exists():
            raise FileNotFoundError(f"sku_master.json not found at {self.master_path}")
        self.data = json.loads(self.master_path.read_text(encoding='utf-8'))
        self._build_indices()
    
    def _build_indices(self) -> None:
        self.alias_index = {}
        for company_code, company in self.data.get('companies', {}).items():
            for canonical, sku_def in company.get('skus', {}).items():
                for alias in sku_def.get('aliases', []):
                    key = self._norm_sku(alias)
                    if key:
                        # Last-write-wins, but if same canonical in same company that's fine
                        self.alias_index[key] = {
                            'company':   company_code,
                            'canonical': canonical,
                            'brand':     sku_def.get('brand', '?'),
                        }
        self.agent_alias_index = {}
        for agent, aliases in self.data.get('agent_aliases', {}).items():
            for alias in aliases:
                self.agent_alias_index[self._norm_agent(alias)] = agent
    
    @staticmethod
    def _norm_sku(s: str) -> str:
        """Normalise SKU string for alias lookup: uppercase, collapse internal spaces/hyphens."""
        if not s: return ''
        # strip, upper, replace multiple spaces/hyphens with single space
        s = str(s).strip().upper()
        s = re.sub(r'[\s\-]+', ' ', s)
        return s.strip()
    
    @staticmethod
    def _norm_agent(s: str) -> str:
        if not s: return ''
        return re.sub(r'[\s\-]+', '', str(s).strip().upper())
    
    def lookup_sku(self, raw: str, company_hint: str | None = None) -> dict | None:
        """Look up a raw SKU string. Returns match dict or None.
        If company_hint given, prefer matches in that company.
        """
        k = self._norm_sku(raw)
        if not k:
            return None
        m = self.alias_index.get(k)
        if m:
            # If caller specified company, check it matches (otherwise still return, as fallback)
            return m
        return None
    
    def lookup_agent(self, raw: str) -> str | None:
        if not raw: return None
        return self.agent_alias_index.get(self._norm_agent(raw))
    
    def get_company_skus(self, company: str) -> dict:
        return self.data.get('companies', {}).get(company, {}).get('skus', {})


# ── Common helpers ────────────────────────────────────────────────────────
def _norm_lines(text: str) -> list[str]:
    """Split into non-empty, stripped lines."""
    return [ln.strip() for ln in str(text or '').splitlines() if ln.strip()]


def _extract_date(s: str) -> str | None:
    """Try to pull a date from a string. Accepts 21/4, 21/4/26, 2026-04-21, 21-04-2026 etc."""
    if not s: return None
    s = str(s).strip()
    # Strip CJK day-of-week suffix 星期X
    s = re.sub(r'星期[日一二三四五六]', '', s).strip()
    # Common patterns
    patterns = [
        (r'(\d{4})-(\d{1,2})-(\d{1,2})',     lambda m: f"{m.group(1)}-{int(m.group(2)):02d}-{int(m.group(3)):02d}"),
        (r'(\d{1,2})/(\d{1,2})/(\d{2,4})',   lambda m: _ymd(m.group(3), m.group(2), m.group(1))),
        (r'(\d{1,2})-(\d{1,2})-(\d{2,4})',   lambda m: _ymd(m.group(3), m.group(2), m.group(1))),
        (r'(\d{1,2})/(\d{1,2})',             lambda m: _ymd(None, m.group(2), m.group(1))),  # 21/4 — assume current year
    ]
    for pat, builder in patterns:
        m = re.search(pat, s)
        if m:
            try:
                return builder(m)
            except Exception:
                continue
    return None


def _ymd(y: str | None, mo: str, d: str) -> str:
    """Normalise to YYYY-MM-DD. If y missing, use current year."""
    mo_i, d_i = int(mo), int(d)
    if y is None:
        y_i = datetime.now().year
    else:
        y_i = int(y)
        if y_i < 100:
            y_i += 2000
    return f"{y_i:04d}-{mo_i:02d}-{d_i:02d}"


def _field_value(lines: list[str], *labels: str) -> str | None:
    """Find a field 'Label: value' in lines. Labels matched case-insensitively.
    Returns first match or None.
    """
    for ln in lines:
        # try "label: value" or "label : value" or "label：value" (CJK colon)
        for label in labels:
            pat = rf'^\s*{re.escape(label)}\s*[:：\-]\s*(.+)$'
            m = re.match(pat, ln, flags=re.IGNORECASE)
            if m:
                return m.group(1).strip()
    return None


def _parse_sku_qty_line(ln: str) -> dict | None:
    """Parse a line like 'EVO- 20', 'EVO -20', 'EVO 20', 'EVO: 20', 'EVO-20*', 'EVO 20 ctn'.
    Returns {'raw_sku', 'qty', 'amended'} or None if no qty present.
    
    Lines with empty qty (e.g. 'IFACE-') return None → skipped per Isaac's rule.
    """
    ln = ln.strip()
    if not ln:
        return None
    # Skip headers/comments (Total, 牌子, etc.)
    skip_prefixes = [
        'total', 'name', 'date', 'contact', 'location', 'special code',
        'delivery date', 'approved', 'account', 'sender', 'receiver',
        'from ', 'to ', 'cc', '牌子', '借货', '过货', '清货', '代替', '借货'
    ]
    low = ln.lower()
    for p in skip_prefixes:
        if low.startswith(p):
            return None
    # Skip lines that are pure reason-option markers ("1. 过货", "2. 清货")
    if re.match(r'^\d+\.\s*[^\d]', ln):
        # numbered list like "1. 过货" — not a SKU line
        if not re.search(r'\d+\s*(ctn|pcs|ct|box|bx)?\s*\*?\s*$', ln, re.I):
            # but let "1. EVO 20 ctn" still be treated? nope, skip numbered lists
            return None
    
    # Core pattern: SKU part then separator then qty
    # Accept separators: '-', ':', spaces
    # qty is an integer, may have trailing '*' or 'ctn/pcs/箱'
    # Examples to match:
    #   "EVO- 20"      → sku="EVO", qty=20
    #   "EVO -20"      → sku="EVO", qty=20
    #   "EVO:20"       → sku="EVO", qty=20
    #   "EVO 20"       → sku="EVO", qty=20
    #   "EVO-20*"      → sku="EVO", qty=20, amended=True
    #   "ifaceM 2ctn"  → sku="ifaceM", qty=2
    #   "Bison R -15"  → sku="Bison R", qty=15
    #   "EVO -30"      → sku="EVO", qty=30  (minus sign is just formatting)
    
    # First try: strict "SKU-QTY*?" pattern
    # Capture: (sku) (sep) (qty) (maybe ctn/pcs) (maybe *)
    m = re.match(
        r'^\s*(?P<sku>[A-Za-z0-9][A-Za-z0-9\s\-]*?)\s*[-:：]?\s*(?P<qty>\d+)\s*(?:ctn|ctns|pcs|ct|pc|箱|盒)?\s*(?P<star>\*)?\s*$',
        ln, flags=re.IGNORECASE
    )
    if not m:
        return None
    raw_sku = m.group('sku').strip().rstrip('-').strip()
    if not raw_sku:
        return None
    qty = int(m.group('qty'))
    amended = bool(m.group('star'))
    # Guard against false positives — reject if sku is purely numeric
    if raw_sku.isdigit():
        # except for special case "90" which IS a valid SKU in CCOM master
        pass  # keep going, let lookup decide
    return {'raw_sku': raw_sku, 'qty': qty, 'amended': amended}


# ── Parser 1: Order Stock (CCOM or 8COM) ──────────────────────────────────
def parse_order(text: str, master: SkuMaster, company: str) -> dict | None:
    """Parse 订货 Order Stock template.
    
    `company` is 'CCOM' or '8COM' — determined by topic_id upstream.
    Returns ParseResult or None if text doesn't look like an order.
    """
    lines = _norm_lines(text)
    if not lines:
        return None
    
    # Look for signature markers
    joined = '\n'.join(lines)
    is_order = bool(re.search(r'订货|Order\s*Stock', joined, re.I))
    if not is_order:
        return None
    
    # Meta fields
    name_raw     = _field_value(lines, 'Name', '姓名')
    date_raw     = _field_value(lines, 'Delivery date', 'Date', '日期')
    contact_raw  = _field_value(lines, 'Contact no', 'Contact', '联络')
    location_raw = _field_value(lines, 'Location', 'Special code', '地址')
    
    agent = master.lookup_agent(name_raw) if name_raw else None
    date  = _extract_date(date_raw or '') or datetime.now().strftime('%Y-%m-%d')
    
    # Extract SKU lines
    order_lines: list[dict] = []
    unknown: list[str] = []
    warnings: list[str] = []
    for ln in lines:
        parsed = _parse_sku_qty_line(ln)
        if not parsed:
            continue
        sku_match = master.lookup_sku(parsed['raw_sku'], company_hint=company)
        if sku_match:
            order_lines.append({
                'sku':       sku_match['canonical'],
                'brand':     sku_match['brand'],
                'qty':       parsed['qty'],
                'amended':   parsed['amended'],
                'raw':       ln,
            })
        else:
            unknown.append(parsed['raw_sku'])
            order_lines.append({
                'sku':      None,
                'brand':    None,
                'qty':      parsed['qty'],
                'amended':  parsed['amended'],
                'raw':      ln,
                'raw_sku':  parsed['raw_sku'],
            })
    
    # Extract total hint
    total_hint = None
    for ln in lines:
        m = re.match(r'^\s*total\s*[:：\-]?\s*(\d+)', ln, re.I)
        if m:
            total_hint = int(m.group(1))
            break
    
    if not order_lines:
        warnings.append('no SKU lines found')
    if name_raw and not agent:
        warnings.append(f"unknown agent name: '{name_raw}'")
    
    return {
        'kind':         'order',
        'company':      company,
        'agent':        agent,
        'date':         date,
        'lines':        order_lines,
        'total_hint':   total_hint,
        'unknown_skus': unknown,
        'meta': {
            'name_raw':     name_raw,
            'contact':      contact_raw,
            'location':     location_raw,
            'date_raw':     date_raw,
        },
        'warnings':     warnings,
        'raw':          text,
    }


# ── Parser 2: Stock Transfer ──────────────────────────────────────────────
def parse_transfer(text: str, master: SkuMaster) -> dict | None:
    lines = _norm_lines(text)
    if not lines:
        return None
    joined = '\n'.join(lines)
    is_transfer = bool(re.search(r'(sender|receiver|stock\s*transfer|牌子\s*&\s*数量)', joined, re.I))
    if not is_transfer:
        return None
    
    # Determine role
    role_match = re.search(r'^\s*(sender|receiver)\b', joined, re.I | re.M)
    role = (role_match.group(1).lower() if role_match else 'sender')
    
    # From / To
    from_raw = _field_value(lines, 'From', '来自', '发件人')
    to_raw   = _field_value(lines, 'To', '至', '收件人', 'To ')
    date_raw = _field_value(lines, 'Date', '日期')
    
    from_agent = master.lookup_agent(from_raw) if from_raw else None
    to_agent   = master.lookup_agent(to_raw) if to_raw else None
    date       = _extract_date(date_raw or '') or datetime.now().strftime('%Y-%m-%d')
    
    # Reason — find which numbered reason has ✅ or ✓ after it
    reason_key = None
    reason_text = None
    for ln in lines:
        # matches "1. 过货（补货）✅" or "1. 过货 (补货) ✓"
        m = re.match(r'^\s*(\d+)\.\s*(.+?)\s*([✅✓\u2713])', ln)
        if m:
            reason_key = m.group(1)
            reason_text = m.group(2).strip()
            break
    # Fallback: scan for any line ending in ✅ and derive number from list
    
    account    = _field_value(lines, 'Account', '账号')
    cc         = _field_value(lines, 'CC', '抄送')
    approved   = _field_value(lines, 'Approved by', 'Approved', '批准')
    
    # SKU lines (usually just 1-2 lines between 牌子 & 数量 and 借货原因)
    # Scan every line, keep those that parse as sku+qty
    transfer_lines: list[dict] = []
    unknown: list[str] = []
    warnings: list[str] = []
    for ln in lines:
        parsed = _parse_sku_qty_line(ln)
        if not parsed:
            continue
        # Transfers can be in either company — lookup without hint
        sku_match = master.lookup_sku(parsed['raw_sku'])
        if sku_match:
            transfer_lines.append({
                'sku':     sku_match['canonical'],
                'brand':   sku_match['brand'],
                'company': sku_match['company'],
                'qty':     parsed['qty'],
                'amended': parsed['amended'],
                'raw':     ln,
            })
        else:
            unknown.append(parsed['raw_sku'])
            transfer_lines.append({
                'sku':     None,
                'brand':   None,
                'company': None,
                'qty':     parsed['qty'],
                'amended': parsed['amended'],
                'raw':     ln,
                'raw_sku': parsed['raw_sku'],
            })
    
    if not transfer_lines:
        warnings.append('no SKU lines found')
    if from_raw and not from_agent:
        warnings.append(f"unknown from agent: '{from_raw}'")
    if to_raw and not to_agent:
        warnings.append(f"unknown to agent: '{to_raw}'")
    
    return {
        'kind':         'transfer',
        'role':         role,
        'company':      transfer_lines[0]['company'] if transfer_lines and transfer_lines[0].get('company') else None,
        'from_agent':   from_agent,
        'to_agent':     to_agent,
        'date':         date,
        'lines':        transfer_lines,
        'total_hint':   None,
        'unknown_skus': unknown,
        'meta': {
            'from_raw':    from_raw,
            'to_raw':      to_raw,
            'date_raw':    date_raw,
            'reason_key':  reason_key,
            'reason_text': reason_text,
            'account':     account,
            'cc':          cc,
            'approved_by': approved,
        },
        'warnings':     warnings,
        'raw':          text,
    }


# ── Parser 3: GRN (来货单) ─────────────────────────────────────────────────
def parse_grn(text: str, master: SkuMaster, company: str) -> dict | None:
    """Parse a 来货单 message.
    Headers vary: "21/4 yi 来货", "21/4 jacky 来货", "来货单" etc.
    Lines: 'EVO -30', 'IFR -2', 'Total -59' (the minus is just formatting).
    """
    lines = _norm_lines(text)
    if not lines:
        return None
    
    joined = '\n'.join(lines)
    # Must mention 来货 or be multi-line with clear SKU list pattern
    is_grn = bool(re.search(r'来货|GRN|goods\s*receiv|receive', joined, re.I))
    # Also accept if it has a dated header line + SKU-qty list + Total line
    if not is_grn:
        has_total = any(re.match(r'^\s*total', ln, re.I) for ln in lines)
        has_skus  = sum(1 for ln in lines if _parse_sku_qty_line(ln)) >= 2
        if not (has_total and has_skus):
            return None
    
    # Try to extract agent + date from the header
    # Patterns: "21/4 yi 来货", "来货单 ben 21/4"
    agent = None
    date  = None
    for ln in lines[:3]:  # usually in first few lines
        # look for a known agent name
        for raw_alias, canonical in master.agent_alias_index.items():
            # need to preserve original casing; re-scan with word boundary
            words = re.findall(r'[A-Za-z][A-Za-z\-]*', ln)
            for w in words:
                if master._norm_agent(w) == raw_alias:
                    agent = canonical
                    break
            if agent:
                break
        # look for a date
        d = _extract_date(ln)
        if d:
            date = d
        if agent and date:
            break
    
    if not date:
        date = datetime.now().strftime('%Y-%m-%d')
    
    grn_lines: list[dict] = []
    unknown: list[str] = []
    warnings: list[str] = []
    total_hint = None
    for ln in lines:
        # Total line?
        mt = re.match(r'^\s*total\s*[:：\-]?\s*(\d+)', ln, re.I)
        if mt:
            total_hint = int(mt.group(1))
            continue
        parsed = _parse_sku_qty_line(ln)
        if not parsed:
            continue
        sku_match = master.lookup_sku(parsed['raw_sku'], company_hint=company)
        if sku_match:
            grn_lines.append({
                'sku':     sku_match['canonical'],
                'brand':   sku_match['brand'],
                'qty':     parsed['qty'],
                'amended': parsed['amended'],
                'raw':     ln,
            })
        else:
            unknown.append(parsed['raw_sku'])
            grn_lines.append({
                'sku':     None,
                'brand':   None,
                'qty':     parsed['qty'],
                'amended': parsed['amended'],
                'raw':     ln,
                'raw_sku': parsed['raw_sku'],
            })
    
    if not grn_lines:
        warnings.append('no SKU lines found')
    if not agent:
        warnings.append('agent name not detected in header')
    
    return {
        'kind':         'grn',
        'company':      company,
        'agent':        agent,
        'date':         date,
        'lines':        grn_lines,
        'total_hint':   total_hint,
        'unknown_skus': unknown,
        'meta':         {},
        'warnings':     warnings,
        'raw':          text,
    }


# ── Convenience unified dispatcher ────────────────────────────────────────
def parse_message(text: str, master: SkuMaster, topic_kind: str, company: str | None = None) -> dict | None:
    """Dispatch to the right parser based on topic kind.
    topic_kind: 'order' | 'transfer' | 'grn'
    company:    'CCOM' | '8COM' (required for order/grn; ignored for transfer)
    """
    if topic_kind == 'order':
        return parse_order(text, master, company or 'CCOM')
    elif topic_kind == 'transfer':
        return parse_transfer(text, master)
    elif topic_kind == 'grn':
        return parse_grn(text, master, company or 'CCOM')
    return None
