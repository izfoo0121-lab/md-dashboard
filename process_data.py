"""
MD Sales Dashboard - Data Processor v3
========================================
Run this script monthly/daily to generate dashboard_data.json

Requirements: pip install openpyxl pandas
"""

import json, os, glob
import pandas as pd

SKU_GROUPS = {
    'IFACE':   ['IFACE B','IFACE DB','IFACE M','IFACE R'],
    'SUKUN':   ['SKNW','SKNR'],
    'EVO':     ['EVO'],
    'BISON':   ['BISON-R','BISON-M','BISON-G'],
    'LAM+LWM': ['LAM','LWM'],
}

MONTH_ORDER = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec']

def find_file(keywords, folder='.'):
    for kw in keywords:
        for pattern in [f'*{kw}*', f'*{kw.lower()}*', f'*{kw.upper()}*']:
            matches = glob.glob(os.path.join(folder, pattern))
            if matches:
                return matches[0]
    return None

def prompt_file(label, keywords):
    found = find_file(keywords)
    if found:
        print(f'  \u2705 Found {label}: {found}')
        return found
    path = input(f'  Enter path to {label}: ').strip().strip('"')
    if not os.path.exists(path):
        raise FileNotFoundError(f'File not found: {path}')
    return path

def sort_months_chronologically(months):
    if not months: return []
    month_set = sorted(set(months), key=lambda m: MONTH_ORDER.index(m))
    indices = [MONTH_ORDER.index(m) for m in month_set]
    has_wrap = any(indices[i+1]-indices[i] > 6 for i in range(len(indices)-1))
    if has_wrap:
        wrap_point = next(i+1 for i in range(len(indices)-1) if indices[i+1]-indices[i] > 6)
        return month_set[wrap_point:] + month_set[:wrap_point]
    return month_set

def find_col(df, options):
    for o in options:
        if o in df.columns: return o
    return None

def main():
    print('\n' + '='*50)
    print('  MD Sales Dashboard — Data Processor v3')
    print('='*50 + '\n')

    print('📁 Locating files...')
    debtor_path = prompt_file('Debtor Maintenance (.xlsx)', ['debtor','Debtor','DEBTOR','maintainance','maintenance'])
    sales_path  = prompt_file('MD Sales Report (.xlsx)',    ['4months','4month','MD','md_sales','sales'])

    # ── Read Debtor Maintenance ──────────────────────────────────────────
    print('\n👥 Reading Debtor Maintenance...')
    df_debtor = pd.read_excel(debtor_path, engine='openpyxl')
    df_debtor.columns = [str(c).strip() for c in df_debtor.columns]

    code_col     = find_col(df_debtor, ['Code','Debtor Code','DebtorCode'])
    name_col     = find_col(df_debtor, ['Company Name','Name','CompanyName'])
    agent_col    = find_col(df_debtor, ['Agent','Sales Agent','SalesAgent'])
    type_col     = find_col(df_debtor, ['Debtor Type','DebtorType','Type'])
    phone_col    = find_col(df_debtor, ['Phone 1','Phone','Tel'])
    attn_col     = find_col(df_debtor, ['Attention','Attn','Remark'])
    opendate_col = find_col(df_debtor, ['Open Acct Date','OpenAcctDate','Open Account Date','Date'])
    bday_col     = find_col(df_debtor, ['Birth Date','BirthDate','Birthday','DOB'])

    if not code_col or not agent_col:
        raise ValueError(f'Cannot find Code/Agent columns. Found: {list(df_debtor.columns)}')

    print(f'  VIP column: {attn_col}')
    print(f'  Open date column: {opendate_col}')
    print(f'  Birth date column: {bday_col}')

    debtor_map = {}
    for _, row in df_debtor.iterrows():
        code  = str(row[code_col]).strip()
        agent = str(row[agent_col]).strip().upper()
        if not code or not agent or code=='nan' or agent in ('NAN',''):
            continue
        attn = str(row[attn_col]).strip() if attn_col else ''
        is_vip = attn.upper() == 'VIP'
        open_date  = None
        bday_mmdd  = None
        if opendate_col:
            od = row[opendate_col]
            if pd.notna(od):
                try:
                    open_date = pd.Timestamp(od).strftime('%Y-%m-%d')
                except: pass
        if bday_col:
            bd = row[bday_col]
            if pd.notna(bd):
                try:
                    bday_mmdd = pd.Timestamp(bd).strftime('%m-%d')  # e.g. "03-27"
                except: pass
        debtor_map[code] = {
            'code':     code,
            'name':     str(row[name_col]).strip() if name_col else code,
            'agent':    agent,
            'type':     str(row[type_col]).strip() if type_col else '',
            'phone':    str(row[phone_col]).strip() if phone_col else '',
            'vip':      is_vip,
            'openDate': open_date,
            'birthday': bday_mmdd,
        }

    print(f'  \u2705 {len(debtor_map)} debtors, {sum(1 for d in debtor_map.values() if d["vip"])} VIP')

    # ── Read MD Sales ─────────────────────────────────────────────────────
    print('\n📊 Reading MD Sales Report...')
    xl = pd.ExcelFile(sales_path, engine='openpyxl')
    md_sheet = next((s for s in xl.sheet_names if 'MD' in s.upper()), xl.sheet_names[0])
    print(f'  Using sheet: \'{md_sheet}\'')

    df_raw = pd.read_excel(sales_path, sheet_name=md_sheet, engine='openpyxl', dtype=str, header=None)
    header_row = 0
    for i, row in df_raw.iterrows():
        vals = [str(v).strip() for v in row.values]
        if 'Tranx Mth' in vals or 'Debtor Code' in vals:
            header_row = i; break

    df_sales = pd.read_excel(sales_path, sheet_name=md_sheet, engine='openpyxl',
                             header=header_row, dtype=str)
    df_sales.columns = [str(c).strip() for c in df_sales.columns]
    df_sales = df_sales.dropna(how='all')
    print(f'  \u2705 {len(df_sales)} rows loaded')

    mth_col    = find_col(df_sales, ['Tranx Mth','Mth','Month','TranxMth'])
    dcode_col  = find_col(df_sales, ['Debtor Code','DebtorCode','Code'])
    dname_col  = find_col(df_sales, ['Company Name','Name'])
    agnt_col2  = find_col(df_sales, ['Sales Agent','Agent','SalesAgent'])
    sku_col    = find_col(df_sales, ['Item Code','ItemCode','SKU'])
    ctn_col    = find_col(df_sales, ['QTY (CTN)','QTY(CTN)','Qty CTN','QTY CTN','CTN'])
    stype_col  = find_col(df_sales, ['Sales type','Sales Type','SalesType','Type'])
    date_col   = find_col(df_sales, ['Date','Inv Date','Invoice Date'])

    if not mth_col or not dcode_col:
        raise ValueError(f'Cannot find Month/Debtor Code columns.\nFound: {list(df_sales.columns)}')

    print(f'  Sales type col: {stype_col} | Date col: {date_col}')

    # Detect months
    all_month_vals = df_sales[mth_col].dropna().str.strip().unique()
    valid_months = [m for m in all_month_vals if m in MONTH_ORDER]
    sorted_months = sort_months_chronologically(valid_months)
    if len(sorted_months) > 3:
        sorted_months = sorted_months[-3:]
    current_month = sorted_months[-1]
    prev_month    = sorted_months[-2] if len(sorted_months) >= 2 else None

    print(f'\n📅 All months: {sort_months_chronologically(valid_months)}')
    print(f'📅 Using: {sorted_months} → Current: {current_month} | Prev: {prev_month}')

    df_sales = df_sales[df_sales[mth_col].str.strip().isin(sorted_months)]

    # ── Aggregate ─────────────────────────────────────────────────────────
    print('\n🔢 Aggregating...')
    debtor_sales = {}

    for _, row in df_sales.iterrows():
        code  = str(row[dcode_col]).strip()
        month = str(row[mth_col]).strip()
        sku   = str(row[sku_col]).strip() if sku_col else ''
        name  = str(row[dname_col]).strip() if dname_col else ''
        agent = str(row[agnt_col2]).strip().upper() if agnt_col2 else ''
        stype = str(row[stype_col]).strip() if stype_col else ''

        if not code or code=='nan' or month not in sorted_months: continue

        try:
            ctn = float(row[ctn_col]) if ctn_col and str(row[ctn_col]) not in ('nan','','None') else 0.0
        except: ctn = 0.0

        # Parse date
        inv_date = None
        if date_col:
            try:
                dv = row[date_col]
                if str(dv) not in ('nan','','None'):
                    inv_date = pd.Timestamp(dv).strftime('%Y-%m-%d')
            except: pass

        if code not in debtor_map and name and agent:
            debtor_map[code] = {'code':code,'name':name,'agent':agent,'type':'','phone':'','vip':False,'openDate':None}

        if code not in debtor_sales:
            debtor_sales[code] = {}
        if month not in debtor_sales[code]:
            debtor_sales[code][month] = {'totalCtn':0.0,'skus':{},'salesTypes':{},'lastDate':None}

        ms = debtor_sales[code][month]
        ms['totalCtn'] += ctn

        if sku and sku != 'nan':
            ms['skus'][sku] = ms['skus'].get(sku,0.0) + ctn
            # Sales type per SKU group
            if stype and stype != 'nan':
                for grp, members in SKU_GROUPS.items():
                    if sku in members:
                        # Keep highest-priority sales type for this group
                        ms['salesTypes'][grp] = stype
                        break

        # Track latest invoice date
        if inv_date:
            if not ms['lastDate'] or inv_date > ms['lastDate']:
                ms['lastDate'] = inv_date

    # Round & clean
    for code in debtor_sales:
        for month in debtor_sales[code]:
            ms = debtor_sales[code][month]
            ms['totalCtn'] = round(ms['totalCtn'], 2)
            ms['skus'] = {k:round(v,2) for k,v in ms['skus'].items()}

    print(f'  \u2705 {len(debtor_sales)} debtors with sales data')

    # ── Output ─────────────────────────────────────────────────────────────
    agents = sorted(set(d['agent'] for d in debtor_map.values() if d['agent']))
    output = {
        'generatedAt':  pd.Timestamp.now().strftime('%Y-%m-%d %H:%M'),
        'sortedMonths': sorted_months,
        'currentMonth': current_month,
        'prevMonth':    prev_month,
        'agents':       agents,
        'skuGroups':    SKU_GROUPS,
        'debtors':      debtor_map,
        'sales':        debtor_sales,
    }

    out_path = 'dashboard_data.json'
    with open(out_path, 'w', encoding='utf-8') as f:
        json.dump(output, f, ensure_ascii=False, separators=(',',':'))

    size_kb = os.path.getsize(out_path)/1024
    print(f'\n\u2705 Saved: {out_path} ({size_kb:.1f} KB)')
    print(f'   Agents:  {agents}')
    print(f'   Months:  {sorted_months}')
    print(f'   Debtors: {len(debtor_map)}')
    vip_count = sum(1 for d in debtor_map.values() if d.get('vip'))
    print(f'   VIP:     {vip_count}')
    print(f'\n\U0001f680 Now open sales_dashboard.html in your browser!')
    print('='*50+'\n')

if __name__ == '__main__':
    try:
        main()
    except Exception as e:
        print(f'\n\u274c Error: {e}')
        import traceback; traceback.print_exc()
    input('\nPress Enter to exit...')
