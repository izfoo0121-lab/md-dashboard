import json
d = json.load(open('data_mar26.json', encoding='utf-8'))

for agent in ['BEN', 'KI-MI', 'NMK', 'YI']:
    nb = d['agents'][agent].get('newbie_scheme', {})
    dc = d['agents'][agent].get('debtor_cards', {})
    print(f"{agent}: newbie_new_accounts={nb.get('new_accounts')} | dc_new_accounts_count={dc.get('new_accounts_count')}")
