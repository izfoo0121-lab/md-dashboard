import json
t = json.load(open('targets.json', encoding='utf-8'))

# Check monthly_targets for Mar 26
mt = t.get('monthly_targets', {}).get('Mar 26', {})
print("Monthly targets Mar 26 agents:", list(mt.keys()))
print()
cj = mt.get('CJ', {})
print("CJ monthly target:", json.dumps(cj, indent=2))
