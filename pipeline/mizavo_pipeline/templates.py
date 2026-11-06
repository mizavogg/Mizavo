"""Generated questions: build Fact or Fake and Odd One Out questions from reference tables.

Each template reads one table in data/ and turns its rows into questions.
Questions about the same fact share a fact key (e.g. "capital-of-australia"), so a
channel only ever sees one of them.
Randomness is seeded, so the same tables always produce the same batch.
"""
import random
from pathlib import Path

import pandas as pd

ORIGIN = "generated"


def _slug(s: str) -> str:
    out = "".join(c.lower() if c.isalnum() else "-" for c in s)
    return "-".join(p for p in out.split("-") if p)


def _ooo(rng, base: list[str], odd: str, **fields) -> dict:
    """Odd One Out with the odd item at a random position."""
    items = base[:]
    pos = rng.randint(0, 3)
    items.insert(pos, odd)
    return {"mode": "ooo", "items": items, "answer": pos, "origin": ORIGIN, **fields}


def _ff(statement: str, answer: bool, **fields) -> dict:
    return {"mode": "ff", "statement": statement, "answer": answer, "origin": ORIGIN, **fields}


def capitals(data: Path, rng) -> list[dict]:
    """'Which isn't a capital?' plus 'X is the capital of Y' statements."""
    caps = pd.read_csv(data / "capitals.csv")
    odd = pd.read_csv(data / "noncapitals.csv")
    src = "https://en.wikipedia.org/wiki/List_of_national_capitals"
    out = []
    for _, r in odd.iterrows():
        pool = caps[caps["country"] != r["country"]]
        famous = pool[pool["tier"] == 1]["capital"].tolist()
        tricky = pool[pool["tier"] == 2]["capital"].tolist()
        # harder questions mix in capitals people often get wrong, so the odd one doesn't stand out
        base = rng.sample(tricky, 2) + rng.sample(famous, 1) if r["difficulty"] == 3 else \
            rng.sample(tricky, 1) + rng.sample(famous, 2) if r["difficulty"] == 2 else rng.sample(famous, 3)
        rng.shuffle(base)
        out.append(_ooo(rng, base, r["city"], explanation=f"{r['why']} The others are all capitals.",
                        difficulty=int(r["difficulty"]), category="geography",
                        fact_key=f"capital-of-{_slug(r['country'])}", source_url=src))
    # one Fact or Fake per country: sometimes the true capital, sometimes the famous city
    for country, grp in odd[odd["difficulty"] >= 2].groupby("country", sort=True):
        r = grp.iloc[0]
        if rng.random() < 0.5:
            st, ans = f"{r['city']} is the capital of {country}.", False
            expl = r["why"]
        else:
            st, ans = f"{r['capital']} is the capital of {country}.", True
            expl = f"{r['capital']} is the capital, even though {r['city']} is better known."
        out.append(_ff(st, ans, explanation=expl, difficulty=int(r["difficulty"]), category="geography",
                       fact_key=f"capital-of-{_slug(country)}", source_url=src))
    return out


def continents(data: Path, rng) -> list[dict]:
    """'Which country is on a different continent?'"""
    cc = pd.read_csv(data / "continents.csv")
    plans = pd.read_csv(data / "continent_plans.csv")
    src = "https://en.wikipedia.org/wiki/List_of_countries_and_territories_by_the_United_Nations_geoscheme"
    out = []
    for _, p in plans.iterrows():
        odd_cont = cc.loc[cc["country"] == p["odd"], "continent"].iloc[0]
        base = rng.sample(cc[(cc["continent"] == p["base"]) & (cc["country"] != p["odd"])]["country"].tolist(), 3)
        out.append(_ooo(rng, base, p["odd"],
                        explanation=f"{p['odd']} is in {odd_cont}. The others are in {p['base']}.",
                        difficulty=int(p["difficulty"]), category="geography",
                        fact_key=f"continent-of-{_slug(p['odd'])}", source_url=src))
    return out


def landlocked(data: Path, rng) -> list[dict]:
    """'Which country has a coastline?' plus landlocked statements."""
    ll = pd.read_csv(data / "landlocked.csv")
    src = "https://en.wikipedia.org/wiki/Landlocked_country"
    locked = ll[ll["landlocked"] == "yes"]
    out = []
    for _, r in ll[ll["landlocked"] == "no"].iterrows():
        same = locked[locked["region"] == r["region"]]["country"].tolist()
        others = locked[locked["region"] != r["region"]]["country"].tolist()
        base = rng.sample(same, min(3, len(same)))
        base += rng.sample(others, 3 - len(base))
        out.append(_ooo(rng, base, r["country"],
                        explanation=f"{r['country']} has a coastline ({r['sea']}). The others are landlocked.",
                        difficulty=int(r["difficulty"]), category="geography",
                        fact_key=f"coast-{_slug(r['country'])}", source_url=src))
    for _, r in pd.read_csv(data / "landlocked_statements.csv").iterrows():
        out.append(_ff(r["statement"], r["answer"] == "fact", explanation=r["explanation"],
                       difficulty=int(r["difficulty"]), category="geography",
                       fact_key=r["fact_key"], source_url=src))
    return out


def euro(data: Path, rng) -> list[dict]:
    """'Which country doesn't use the euro?' plus euro statements."""
    cur = pd.read_csv(data / "currency.csv")
    src = "https://en.wikipedia.org/wiki/Eurozone"
    euro_list = cur[cur["euro"] == "yes"]["country"].tolist()
    out = []
    for _, r in cur[cur["euro"] == "no"].iterrows():
        out.append(_ooo(rng, rng.sample(euro_list, 3), r["country"],
                        explanation=f"{r['country']} uses the {r['currency']}, not the euro. The others use the euro.",
                        difficulty=int(r["difficulty"]), category="geography",
                        fact_key=f"currency-{_slug(r['country'])}", source_url=src))
    for _, r in cur[cur["statement"].notna()].iterrows():
        is_euro = r["euro"] == "yes"
        expl = (f"{r['country']} uses the euro" + (f" ({r['note']})." if isinstance(r["note"], str) else ".")) if is_euro \
            else f"{r['country']} uses the {r['currency']}."
        out.append(_ff(f"{r['country']} uses the euro.", is_euro, explanation=expl,
                       difficulty=int(r["statement_difficulty"]), category="geography",
                       fact_key=f"currency-{_slug(r['country'])}", source_url=src))
    return out


def areas(data: Path, rng) -> list[dict]:
    """'X is bigger than Y' (by total area)."""
    src = "https://en.wikipedia.org/wiki/List_of_countries_and_dependencies_by_area"
    def fmt(km2: float, digits: int) -> str:
        return f"{km2 / 1e6:.{digits}f} million km²" if km2 >= 1e6 else f"{round(km2, -3):,.0f} km²"
    out = []
    for _, r in pd.read_csv(data / "areas.csv").iterrows():
        bigger = r["a_km2"] > r["b_km2"]
        # use enough decimals that the two sizes never look the same (1.56 vs 1.65, not 1.6 vs 1.6)
        digits = 1 if fmt(r["a_km2"], 1) != fmt(r["b_km2"], 1) else 2
        expl = f"{r['a']} covers about {fmt(r['a_km2'], digits)}, {r['b']} about {fmt(r['b_km2'], digits)}."
        if isinstance(r["note"], str):
            expl += " " + r["note"]
        out.append(_ff(f"{r['a']} is bigger than {r['b']}.", bool(bigger), explanation=expl,
                       difficulty=int(r["difficulty"]), category="geography",
                       fact_key=f"area-{_slug(r['a'])}-vs-{_slug(r['b'])}", source_url=src))
    return out


def groups(data: Path, rng) -> list[dict]:
    """Odd One Out from simple groups: noble gases, giant planets, mammals, oceans."""
    g = pd.read_csv(data / "groups.csv")
    out = []
    for gid, members in g[g["role"] == "member"].groupby("group"):
        label = members["label"].iloc[0]
        for _, o in g[(g["role"] == "odd") & (g["group"] == gid)].iterrows():
            base = rng.sample(members["item"].tolist(), 3)
            out.append(_ooo(rng, base, o["item"], explanation=f"{o['why']} The others are {label}.",
                            difficulty=int(o["difficulty"]), category=o["category"],
                            fact_key=o["fact_key"], source_url=o["source_url"]))
    return out


def primes(data: Path, rng) -> list[dict]:
    """'Which number isn't prime?' The odd one is a number that looks prime but isn't."""
    def is_prime(n): return n > 1 and all(n % d for d in range(2, int(n ** 0.5) + 1))
    def factor(n): return next(d for d in range(2, n) if n % d == 0)
    src = "https://en.wikipedia.org/wiki/Prime_number"
    tricky = {51: 3, 57: 3, 87: 3, 91: 3, 93: 3, 39: 2, 49: 2, 69: 2, 77: 2, 21: 1, 27: 1, 33: 1}
    out = []
    for n, diff in tricky.items():
        assert not is_prime(n)
        near = [p for p in range(max(2, n - 30), n + 30) if is_prime(p)]
        base = [str(p) for p in rng.sample(near, 3)]
        f = factor(n)
        out.append(_ooo(rng, base, str(n), explanation=f"{n} = {f} × {n // f}, so it isn't prime. The others are prime.",
                        difficulty=diff, category="science", fact_key=f"{n}-not-prime", source_url=src))
    return out


ALL = [capitals, continents, landlocked, euro, areas, groups, primes]


def generate(data: Path, seed: int = 2026) -> pd.DataFrame:
    rng = random.Random(seed)
    rows = []
    for template in ALL:
        rows += template(data, rng)
    return pd.DataFrame(rows)
