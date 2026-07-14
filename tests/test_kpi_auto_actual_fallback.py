import unittest

import process_data


class KpiAutoActualFallbackTests(unittest.TestCase):
    def test_new_accounts_uses_generated_actual_until_admin_overrides_it(self):
        targets = {
            "agents": {"CJ": {"kpi_targets": {"new_accounts": 4}}},
            "kpi_weights": {"Jul 26": {"new_accounts": 0.04}},
        }
        sales_progression = {
            "CJ": {"tiers": {"normal_t1": {"pct": 0}}},
        }
        debtor_cards = {
            "CJ": {
                "opened_this_month": 3,
                "debtors": [],
                "reactivation_count": 0,
                "total_new_sku": 0,
                "activation_rate": 0,
            }
        }

        result = process_data.calc_kpi(
            ["CJ"],
            targets,
            sales_progression,
            {"CJ": {}},
            debtor_cards,
            birthday_camp={},
            cur_month="Jul 26",
        )

        item = result["CJ"]["items"]["new_accounts"]
        self.assertEqual(item["actual"], 3)
        self.assertEqual(item["target"], 4)
        self.assertTrue(item["needs_supabase_fetch"])


if __name__ == "__main__":
    unittest.main()
