import json
d = json.load(open('data_mar26.json', encoding='utf-8'))
dc = d['agents']['CJ']['debtor_cards']
print('CJ kpi_targets:', dc.get('kpi_targets'))
print('CJ new_accounts_count:', dc.get('new_accounts_count'))
