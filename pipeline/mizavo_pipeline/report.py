"""The balance report: how the batch splits by mode, difficulty and category."""
import pandas as pd

from .rules import DIFFICULTIES, DIFFICULTY_TARGET


def _table(df: pd.DataFrame) -> str:
    """A pandas table as Markdown, without needing extra packages."""
    cols = [str(c) for c in df.columns]
    lines = ["| " + " | ".join([df.index.name or ""] + cols) + " |",
             "|" + "---|" * (len(cols) + 1)]
    for idx, row in df.iterrows():
        lines.append("| " + " | ".join([str(idx)] + [str(v) for v in row.tolist()]) + " |")
    return "\n".join(lines)


def build_report(good: pd.DataFrame, rejected: pd.DataFrame, generated: int, handwritten: int) -> str:
    out = ["# Mizavo pipeline report", ""]
    out.append(f"- Input: {generated} generated + {handwritten} handwritten = {generated + handwritten}")
    out.append(f"- **Good drafts: {len(good)}**")
    out.append(f"- Rejected: {len(rejected)} (see rejected.csv for reasons)")
    out.append("")
    if not len(good):
        return "\n".join(out)

    g = good.copy()
    g["level"] = g["difficulty"].map(DIFFICULTIES)
    mode_names = {"ff": "Fact or Fake", "ooo": "Odd One Out"}
    g["mode"] = g["mode"].map(mode_names)

    by = pd.crosstab(g["mode"], g["level"], margins=True, margins_name="total")
    by = by.reindex(columns=[c for c in ["easy", "medium", "hard", "total"] if c in by.columns])
    by.index.name = "mode"
    out += ["## By mode and difficulty", "", _table(by), ""]

    share = g["difficulty"].value_counts(normalize=True).sort_index()
    out.append("Target is 30% easy / 40% medium / 30% hard. This batch: " +
               ", ".join(f"{DIFFICULTIES[d]} {share.get(d, 0):.0%} (target {t:.0%})" for d, t in DIFFICULTY_TARGET.items()))
    out.append("")

    cats = pd.crosstab(g["category"], g["mode"], margins=True, margins_name="total")
    cats.index.name = "category"
    out += ["## By category", "", _table(cats), ""]

    src = g["origin"].value_counts().rename_axis("origin").to_frame("questions")
    out += ["## By origin", "", _table(src), ""]

    shared = good["fact_key"].value_counts()
    shared = shared[shared > 1]
    out.append(f"Facts with more than one version (a channel only ever sees one): {len(shared)}")

    if len(rejected):
        out += ["", "## Rejected", ""]
        for _, r in rejected.iterrows():
            out.append(f"- `{r.get('fact_key', '')}`: {r['reasons']}")
    return "\n".join(out) + "\n"
