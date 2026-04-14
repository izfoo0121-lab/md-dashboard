import json
d = json.load(open('data_mar26.json', encoding='utf-8'))
dc = d['agents']['CJ']['debtor_cards']
print('CJ debtor_cards.kpi_targets:', dc.get('kpi_targets'))
print('CJ debtor_cards keys:', list(dc.keys()))
