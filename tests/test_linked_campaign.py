import unittest
from pathlib import Path
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))
import process_data


class LinkedCampaignScoringTests(unittest.TestCase):
    def test_linked_campaign_score_uses_two_stage_internal_units(self):
        settings = {
            "conversion_target_pct": 20,
            "repeat_target_pct": 30,
            "conversion_units": 20,
            "repeat_units": 30,
        }

        score = process_data.calculate_linked_campaign_score(
            eligible_base=100,
            converted_actual=15,
            repeat_actual=3,
            settings=settings,
        )

        self.assertEqual(score["conversion_target"], 20)
        self.assertEqual(score["repeat_target"], 5)
        self.assertEqual(score["conversion_actual"], 15)
        self.assertEqual(score["repeat_actual"], 3)
        self.assertEqual(score["campaign_target"], 50)
        self.assertAlmostEqual(score["campaign_actual"], 33.0)

    def test_linked_campaign_targets_round_up_and_cap_each_component(self):
        score = process_data.calculate_linked_campaign_score(
            eligible_base=13,
            converted_actual=3,
            repeat_actual=2,
            settings={"conversion_target_pct": 20, "repeat_target_pct": 30},
        )

        self.assertEqual(score["conversion_target"], 3)
        self.assertEqual(score["repeat_target"], 1)
        self.assertEqual(score["campaign_target"], 50)
        self.assertEqual(score["campaign_actual"], 50)


if __name__ == "__main__":
    unittest.main()
