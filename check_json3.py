import json
d = json.load(open('data_mar26.json', encoding='utf-8'))
dc = d['agents']['CJ']['debtor_cards']
print('current_month in data_mar26.json:', d.get('current_month'))
print('CJ kpi_targets:', dc.get('kpi_targets'))
d2 = json.load(open('dashboard_data.json', encoding='utf-8'))
print('current_month in dashboard_data.json:', d2.get('current_month'))
