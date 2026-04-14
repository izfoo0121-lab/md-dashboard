import json
d = json.load(open('data_mar26.json', encoding='utf-8'))
print("=== current_month:", d.get('current_month'))
dc = d['agents']['CJ']['debtor_cards']
print("CJ kpi_targets:", dc.get('kpi_targets'))
d2 = json.load(open('dashboard_data.json', encoding='utf-8'))
print("dashboard_data current_month:", d2.get('current_month'))
print()
print("=== Newbie scheme per agent ===")
for agent, data in d['agents'].items():
    nb = data.get('newbie_scheme')
    if nb:
        print(f"{agent}: is_newbie={nb.get('is_newbie')} normal_ctn={nb.get('normal_ctn')}")
    else:
        print(f"{agent}: no newbie scheme")
