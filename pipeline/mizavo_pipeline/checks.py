"""Checks: decide which rows are good drafts and why the others aren't.

Every rejected row gets a plain-English reason. Nothing is silently dropped.
"""
from difflib import SequenceMatcher

import pandas as pd

from . import rules


def _text(row) -> str:
    """The words a player sees: the statement, or the four items."""
    if row["mode"] == "ff":
        return str(row.get("statement") or "")
    return " | ".join(row.get("items") or [])


def _odd(row) -> str | None:
    """The odd item of an Odd One Out question (None for Fact or Fake)."""
    if row["mode"] != "ooo" or not isinstance(row.get("items"), list) or not isinstance(row.get("answer"), int):
        return None
    return str(row["items"][row["answer"]]).strip().lower() if 0 <= row["answer"] < len(row["items"]) else None


def validate_row(row) -> list[str]:
    """Return every problem with one question (an empty list means it's fine)."""
    problems = []
    mode = row.get("mode")
    if mode not in rules.MODES:
        return [f"mode must be ff or ooo, got {mode!r}"]

    if mode == "ff":
        st = str(row.get("statement") or "").strip()
        if not st:
            problems.append("statement is empty")
        elif len(st) < 10:
            problems.append("statement is shorter than 10 characters")
        elif len(st) > rules.STATEMENT_MAX:
            problems.append(f"statement is {len(st)} characters (max {rules.STATEMENT_MAX}, so it reads in time)")
        if not isinstance(row.get("answer"), bool):
            problems.append("answer must be fact or fake")
    else:
        items = row.get("items")
        if not isinstance(items, list) or len(items) != 4:
            problems.append("needs exactly 4 items")
        else:
            if any(not str(i).strip() for i in items):
                problems.append("an item is empty")
            if len({str(i).strip().lower() for i in items}) < 4:
                problems.append("the 4 items must all be different")
            if any(len(str(i)) > rules.ITEM_MAX for i in items):
                problems.append(f"an item is longer than {rules.ITEM_MAX} characters")
        ans = row.get("answer")
        if isinstance(ans, bool) or not isinstance(ans, int) or not 0 <= ans <= 3:
            problems.append("answer must be the position of the odd item (A-D)")

    expl = str(row.get("explanation") or "").strip()
    if not rules.EXPLANATION_MIN <= len(expl) <= rules.EXPLANATION_MAX:
        problems.append(f"explanation is {len(expl)} characters (needs {rules.EXPLANATION_MIN}-{rules.EXPLANATION_MAX})")
    if row.get("difficulty") not in rules.DIFFICULTIES:
        problems.append("difficulty must be 1 (easy), 2 (medium) or 3 (hard)")
    if row.get("category") not in rules.CATEGORIES:
        problems.append(f"unknown category {row.get('category')!r}")
    if not rules.FACT_KEY_RE.match(str(row.get("fact_key") or "")):
        problems.append("fact key must be lowercase-words-with-dashes")
    if not rules.SOURCE_RE.match(str(row.get("source_url") or "")):
        problems.append("source must be a full http(s) link")
    if row.get("origin") not in rules.ORIGINS:
        problems.append(f"unknown origin {row.get('origin')!r}")

    words = _text(row) + " " + expl
    m = rules.REGIONAL_RE.search(words)
    if m:
        problems.append(f"may be region-specific (contains {m.group(0)!r}); worldwide content only")
    return problems


STOPWORDS = {"a", "an", "the", "is", "are", "was", "were", "of", "in", "on", "to", "and", "than", "it", "its",
             "for", "by", "with", "at", "as", "be", "that", "this", "has", "have", "can", "all", "more", "most"}


def _stem(w: str) -> str:
    """Rough plural trimming, so 'octopuses' matches 'octopus' and 'hearts' matches 'heart'."""
    if w.endswith("es") and w[:-2].endswith(("s", "x", "ch", "sh")):
        return w[:-2]
    if len(w) > 3 and w.endswith("s") and not w.endswith(("ss", "us", "is")):
        return w[:-1]
    return w


def _words(text: str) -> set[str]:
    clean = "".join(c.lower() if c.isalnum() else " " for c in text)
    return {_stem(w) for w in clean.split() if w not in STOPWORDS}


def _similar(a: str, b: str) -> float:
    """How alike two questions are, 0..1.
    Odd One Out: share of the four items in common. Fact or Fake: share of meaningful words in common.
    (Comparing letters flagged different facts with the same sentence shape, like
    'Earth is the densest planet' vs 'Mars is the hottest planet'.)"""
    if " | " in a and " | " in b:
        ia = {_stem(x.strip().lower()) for x in a.split("|")}
        ib = {_stem(x.strip().lower()) for x in b.split("|")}
        return len(ia & ib) / 4
    wa, wb = _words(a), _words(b)
    if not wa or not wb:
        return 0.0
    return len(wa & wb) / len(wa | wb)


def run_checks(batch: pd.DataFrame, existing: pd.DataFrame) -> tuple[pd.DataFrame, pd.DataFrame]:
    """Split a batch into (good, rejected). `existing` is the current question bank."""
    good_rows, rejected = [], []
    existing_keys = set(existing["fact_key"]) if len(existing) else set()
    existing_texts = list(existing["text"]) if len(existing) else []
    kept: list[tuple[str, str | None]] = []

    for _, row in batch.iterrows():
        r = row.to_dict()
        reasons = validate_row(r)
        text = _text(r)
        if r.get("fact_key") in existing_keys:
            reasons.append("this fact is already in the question bank (same fact key)")
        if not reasons:
            for old in existing_texts:
                if _similar(text, old) >= rules.SIMILARITY_LIMIT:
                    reasons.append(f"almost the same wording as an existing question: {old!r}")
                    break
        if not reasons:
            odd = _odd(r)
            for new, new_odd in kept:
                # within a batch we know both answers: Odd One Out sets only clash if the odd item is the same too
                if odd is not None and new_odd is not None and odd != new_odd:
                    continue
                if _similar(text, new) >= rules.SIMILARITY_LIMIT:
                    reasons.append(f"almost the same as another question in this batch: {new!r}")
                    break
        if reasons:
            rejected.append({**r, "text": text, "reasons": "; ".join(reasons)})
        else:
            kept.append((text, _odd(r)))
            good_rows.append(r)

    return pd.DataFrame(good_rows), pd.DataFrame(rejected)
