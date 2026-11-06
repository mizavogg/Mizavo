# Mizavo content pipeline

Python + pandas. Turns source material into draft questions, checks every row, and writes a file
you upload with the admin page's **Import drafts** button. Nothing can be played until an admin approves it.

## How it works

1. **Collect**
   - *Generated:* `mizavo_pipeline/templates.py` builds questions from reference tables in `data/`
     (capitals, continents, landlocked countries, the euro, country areas, element/planet/animal/ocean groups, primes).
   - *Handwritten:* rows in `input/handwritten.csv`.
2. **Check** (`mizavo_pipeline/checks.py`, rules in `rules.py`, the same rules the database enforces)
   - every field present and valid: mode, answer, 10–300 character explanation, difficulty, category, fact key, source link
   - readable on stream: Fact or Fake statements 10–160 characters, Odd One Out items up to 40
   - **worldwide:** flags wording that usually means one country (our, miles, Fahrenheit, Super Bowl…)
   - **no repeats:** same fact key as the bank, or near-identical wording/items (bank or batch)
3. **Report** (`report.py`): counts by mode × difficulty against the 30/40/30 target, by category, by origin.
4. **Output** to `out/`: `drafts.json` (to import), `drafts.csv` (for Excel), `rejected.csv` (with reasons), `report.md`.

## Run it

```
cd pipeline
pip install -r requirements.txt
python build.py              # build a batch
python -m unittest           # run the tests for the checks
```

Before building, download the current bank from the admin page (**Download bank**) and save it as
`input/existing.csv`, so the repeat check sees every question already in the database.

## Folders

```
build.py               run this
mizavo_pipeline/       the code (rules, checks, templates, report, io)
tests/                 tests for the checks
data/                  reference tables        ┐
input/                 handwritten + existing  ├ not in the repo: question content never goes on GitHub
out/                   results                 ┘
```

Same fact, more than one question: questions share a **fact key** when they test the same fact
(e.g. `capital-of-canada` for "Which isn't a capital?" with Toronto, and "Ottawa is the capital of Canada").
A channel only ever sees one of them.
