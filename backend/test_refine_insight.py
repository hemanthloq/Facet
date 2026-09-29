import unittest
import sys
import os
sys.path.insert(0, os.path.dirname(__file__))
from refine import do_refine, _refine_heuristic
from insight import do_insight

class TestRefineAndInsight(unittest.TestCase):
    def setUp(self):
        self.sample_rows = [
            {
                "id": "r1",
                "name": "ASUS Vivobook 15",
                "price": 54990,
                "ram": "16GB",
                "battery": "18 hrs",
                "rating": 4.5,
                "source_snippet": "Praised for build quality and fast charging. Lightweight chassis."
            },
            {
                "id": "r2",
                "name": "Lenovo IdeaPad Slim 5",
                "price": 58490,
                "ram": "16GB",
                "battery": "16 hrs",
                "rating": 4.3,
                "source_snippet": "Speakers described as tinny at high volume. Multiple reviews mention battery health drops after 8 months."
            },
            {
                "id": "r3",
                "name": "HP Pavilion 15",
                "price": 46990,
                "ram": "8GB",
                "battery": "14 hrs",
                "rating": 4.1,
                "source_snippet": "Budget friendly option with decent performance."
            }
        ]
        self.query = "best laptops under 60k with good battery"

    def test_refine_filter_under_price(self):
        res = _refine_heuristic(self.query, self.sample_rows, "only show under 50k")
        self.assertIn("caption", res)
        self.assertIn("columns", res)
        self.assertIn("rows", res)
        # HP Pavilion is 46990, so it should be included
        self.assertEqual(len(res["rows"]), 1)
        self.assertEqual(res["rows"][0]["id"], "r3")
        self.assertEqual(res["rows"][0]["price"], 46990)
        self.assertEqual(res["rows"][0]["source_snippet"], "Budget friendly option with decent performance.")

    def test_refine_sort_cheapest(self):
        res = _refine_heuristic(self.query, self.sample_rows, "sort by cheapest")
        self.assertEqual(len(res["rows"]), 3)
        self.assertEqual(res["rows"][0]["id"], "r3")  # 46990
        self.assertEqual(res["rows"][1]["id"], "r1")  # 54990
        self.assertEqual(res["rows"][2]["id"], "r2")  # 58490

    def test_refine_exclude(self):
        res = _refine_heuristic(self.query, self.sample_rows, "exclude Lenovo")
        self.assertEqual(len(res["rows"]), 2)
        names = [r["name"] for r in res["rows"]]
        self.assertNotIn("Lenovo IdeaPad Slim 5", names)
        self.assertIn("ASUS Vivobook 15", names)

    def test_refine_symbol_tier(self):
        restaurant_rows = [
            {"id": "r1", "name": "Fancy Bistro", "price_level": "$$$", "cuisine": "French"},
            {"id": "r2", "name": "Cozy Cafe", "price_level": "$$", "cuisine": "Bakery"},
            {"id": "r3", "name": "Street Eatery", "price_level": "$", "cuisine": "Fast Food"}
        ]
        res = _refine_heuristic("best restaurants", restaurant_rows, "only show $$")
        self.assertEqual(len(res["rows"]), 2)
        ids = [r["id"] for r in res["rows"]]
        self.assertIn("r2", ids) # $$
        self.assertIn("r3", ids) # $
        self.assertNotIn("r1", ids) # $$$ excluded

    def test_insight_with_snippet(self):
        row = self.sample_rows[1] # Lenovo with flag
        res = do_insight(row)
        self.assertIn("pros", res)
        self.assertIn("cons", res)
        self.assertIn("flag", res)
        self.assertTrue(len(res["pros"]) > 0 or len(res["cons"]) > 0 or res["flag"] is not None)

    def test_insight_without_snippet(self):
        row = {"id": "r4", "name": "Mystery Laptop", "price": 40000}
        res = do_insight(row)
        self.assertEqual(res["pros"], [])
        self.assertEqual(res["cons"], [])
        self.assertIsNone(res["flag"])
        self.assertIn("note", res)

if __name__ == "__main__":
    unittest.main()
