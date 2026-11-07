"""Tests for the checks: each one proves a rule catches what it should (and lets good rows through).
Run from the pipeline folder:  python -m unittest
"""
import unittest

import pandas as pd

from mizavo_pipeline.checks import run_checks, validate_row


def ff(**kw):
    row = dict(mode="ff", statement="Glorbs have three tails.", answer=True,
               explanation="Made-up example used only in tests.", difficulty=1,
               category="animals", fact_key="glorb-tails-test", source_url="https://example.org/glorb",
               origin="handwritten")
    row.update(kw)
    return row


def ooo(items, answer, key, **kw):
    row = dict(mode="ooo", items=items, answer=answer, explanation="The odd one is different from the rest.",
               difficulty=2, category="animals", fact_key=key, source_url="https://example.org/zib",
               origin="generated")
    row.update(kw)
    return row


EXISTING = pd.DataFrame({"fact_key": ["glorb-three-tails"], "text": ["A glorb has three tails."]})


class TestRules(unittest.TestCase):
    def test_good_row_passes(self):
        self.assertEqual(validate_row(ff()), [])

    def test_bad_fields_are_caught(self):
        self.assertTrue(validate_row(ff(fact_key="Glorb Tails")))      # not lowercase-with-dashes
        self.assertTrue(validate_row(ff(source_url="wikipedia")))          # not a link
        self.assertTrue(validate_row(ff(explanation="Short")))             # under 10 characters
        self.assertTrue(validate_row(ff(category="weather")))              # unknown category
        self.assertTrue(validate_row(ff(answer="fact")))                   # answer must be true/false
        self.assertTrue(validate_row(ooo(["A", "B", "B", "C"], 0, "x")))   # repeated item

    def test_regional_wording_is_flagged(self):
        problems = validate_row(ff(statement="The tallest building in our state is 300 feet tall."))
        self.assertTrue(any("region" in p for p in problems))


class TestDuplicates(unittest.TestCase):
    def test_same_fact_key_as_bank_is_rejected(self):
        good, bad = run_checks(pd.DataFrame([ff(fact_key="glorb-three-tails", statement="Glorbs grow 3 tails.")]), EXISTING)
        self.assertEqual(len(good), 0)

    def test_reworded_repeat_of_bank_is_rejected(self):
        good, bad = run_checks(pd.DataFrame([ff()]), EXISTING)
        self.assertEqual(len(good), 0)
        self.assertIn("existing question", bad.iloc[0]["reasons"])

    def test_same_shape_different_fact_is_kept(self):
        rows = [ff(statement="Planet Zed is the coldest planet in the Glorb System.", fact_key="zed-coldest"),
                ff(statement="Planet Qor is the windiest planet in the Glorb System.", fact_key="qor-windiest")]
        good, bad = run_checks(pd.DataFrame(rows), EXISTING)
        self.assertEqual(len(good), 2)

    def test_odd_one_out_same_answer_is_rejected(self):
        rows = [ooo(["Zib", "Zab", "Zob", "Quux"], 3, "quux-a"),
                ooo(["Zab", "Zib", "Zeb", "Quux"], 3, "quux-b")]
        good, bad = run_checks(pd.DataFrame(rows), EXISTING)
        self.assertEqual(len(good), 1)

    def test_odd_one_out_different_answer_is_kept(self):
        rows = [ooo(["Zib", "Zab", "Zob", "Quux"], 3, "quux-c"),
                ooo(["Zib", "Zab", "Zob", "Flim"], 3, "flim-c")]
        good, bad = run_checks(pd.DataFrame(rows), EXISTING)
        self.assertEqual(len(good), 2)


if __name__ == "__main__":
    unittest.main()
