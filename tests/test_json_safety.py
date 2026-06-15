import json
import math
import tempfile
import unittest
from pathlib import Path

import pandas as pd

import process_data


class JsonSafetyTests(unittest.TestCase):
    def test_write_dashboard_json_replaces_non_finite_values(self):
        payload = {
            "agent": "BEN",
            "company_name": float("nan"),
            "bad_positive": float("inf"),
            "bad_negative": float("-inf"),
            "rows": [
                {"company_name": pd.NA, "qty": 2},
                {"company_name": "OK", "qty": math.nan},
            ],
        }

        with tempfile.TemporaryDirectory() as tmp:
            out = Path(tmp) / "dashboard_data.json"
            process_data.write_dashboard_json(out, payload)

            raw = out.read_text(encoding="utf-8")
            self.assertNotIn("NaN", raw)
            self.assertNotIn("Infinity", raw)
            loaded = json.loads(raw)

        self.assertIsNone(loaded["company_name"])
        self.assertIsNone(loaded["bad_positive"])
        self.assertIsNone(loaded["bad_negative"])
        self.assertIsNone(loaded["rows"][0]["company_name"])
        self.assertIsNone(loaded["rows"][1]["qty"])
        self.assertEqual(loaded["rows"][0]["qty"], 2)


if __name__ == "__main__":
    unittest.main()
