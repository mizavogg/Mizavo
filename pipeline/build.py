"""Mizavo content pipeline: build a batch of draft questions.

Usage (from the pipeline folder):
    python build.py

Reads:
    data/*.csv               reference tables for generated questions
    input/handwritten.csv    handwritten questions
    input/existing.csv       the current question bank (admin page → Download bank)
Writes to out/:
    drafts.json   upload this with the admin page's "Import drafts" button
    drafts.csv    the same batch, for reading in Excel
    rejected.csv  rows that failed a check, with the reason
    report.md     balance report (mode × difficulty, categories)

None of these folders are in the public repo: question content never goes on GitHub.
"""
import argparse
from pathlib import Path

import pandas as pd

from mizavo_pipeline import checks, io, report, templates

HERE = Path(__file__).parent


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    ap.add_argument("--data", type=Path, default=HERE / "data")
    ap.add_argument("--handwritten", type=Path, default=HERE / "input" / "handwritten.csv")
    ap.add_argument("--existing", type=Path, default=HERE / "input" / "existing.csv")
    ap.add_argument("--out", type=Path, default=HERE / "out")
    ap.add_argument("--seed", type=int, default=2026, help="change to get a different mix of generated questions")
    args = ap.parse_args()

    gen = templates.generate(args.data, args.seed)
    hand = io.read_handwritten(args.handwritten) if args.handwritten.exists() else pd.DataFrame()
    batch = pd.concat([gen, hand], ignore_index=True)
    existing = io.read_existing(args.existing)

    good, rejected = checks.run_checks(batch, existing)
    text = report.build_report(good, rejected, len(gen), len(hand))
    io.write_outputs(good, rejected, text, args.out)
    print(text)
    print(f"Wrote {args.out}/drafts.json ({len(good)} drafts)")


if __name__ == "__main__":
    main()
