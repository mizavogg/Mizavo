"""Reading inputs and writing outputs."""
import json
from pathlib import Path

import pandas as pd

COLUMNS = ["mode", "statement", "items", "answer", "explanation", "difficulty",
           "category", "fact_key", "source_url", "origin"]


def read_handwritten(path: Path) -> pd.DataFrame:
    """Handwritten questions: one per row.
    ff rows:  answer = fact | fake, statement filled in
    ooo rows: answer = A | B | C | D, items = four options separated by |
    """
    df = pd.read_csv(path, dtype=str).fillna("")
    rows = []
    for _, r in df.iterrows():
        mode = r["mode"].strip()
        row = {"mode": mode, "explanation": r["explanation"].strip(), "category": r["category"].strip(),
               "fact_key": r["fact_key"].strip(), "source_url": r["source_url"].strip(), "origin": "handwritten"}
        try:
            row["difficulty"] = int(r["difficulty"])
        except ValueError:
            row["difficulty"] = None
        ans = r["answer"].strip().lower()
        if mode == "ff":
            row["statement"] = r["statement"].strip()
            row["answer"] = {"fact": True, "fake": False}.get(ans, ans)
        else:
            row["items"] = [i.strip() for i in r["items"].split("|")]
            row["answer"] = "abcd".index(ans) if ans in ("a", "b", "c", "d") else ans
        rows.append(row)
    return pd.DataFrame(rows)


def read_existing(path: Path) -> pd.DataFrame:
    """The current question bank, exported from the admin page (Download bank).
    Needs at least: fact_key, mode, statement, items."""
    if not path.exists():
        return pd.DataFrame(columns=["fact_key", "text"])
    df = pd.read_csv(path, dtype=str).fillna("")
    df["text"] = df.apply(lambda r: r["statement"] if r["mode"] == "ff" else r["items"], axis=1)
    return df[["fact_key", "text"]]


def write_outputs(good: pd.DataFrame, rejected: pd.DataFrame, report: str, out: Path) -> None:
    out.mkdir(parents=True, exist_ok=True)
    # drafts.json: exactly what the admin page's Import button sends to the database
    records = []
    for _, r in good.iterrows():
        rec = {k: r[k] for k in COLUMNS if k in r and not (isinstance(r[k], float) and pd.isna(r[k]))}
        if rec["mode"] == "ff":
            rec.pop("items", None)
        else:
            rec.pop("statement", None)
        rec["difficulty"] = int(rec["difficulty"])
        rec["answer"] = bool(rec["answer"]) if rec["mode"] == "ff" else int(rec["answer"])
        records.append(rec)
    (out / "drafts.json").write_text(json.dumps(records, ensure_ascii=False, indent=1), encoding="utf-8")

    # drafts.csv: the same batch, easy to read in Excel
    view = good.copy()
    view["question"] = view.apply(lambda r: r["statement"] if r["mode"] == "ff" else " | ".join(r["items"]), axis=1)
    view["answer"] = view.apply(lambda r: ("FACT" if r["answer"] else "FAKE") if r["mode"] == "ff" else "ABCD"[int(r["answer"])], axis=1)
    view[["mode", "question", "answer", "difficulty", "category", "explanation", "fact_key", "source_url", "origin"]] \
        .to_csv(out / "drafts.csv", index=False, encoding="utf-8-sig")
    if len(rejected):
        rejected.to_csv(out / "rejected.csv", index=False, encoding="utf-8-sig")
    (out / "report.md").write_text(report, encoding="utf-8")
