"""The rules every question must follow.

These mirror the checks in the database (supabase/migrations/..._create_questions.sql),
so problems are caught here, with a clear reason, before anything is uploaded.
"""
import re

MODES = {"ff", "ooo"}                      # ff = Fact or Fake, ooo = Odd One Out
CATEGORIES = {
    "animals", "space", "geography", "history", "food",
    "science", "human_body", "pop_culture", "language",
}
DIFFICULTIES = {1: "easy", 2: "medium", 3: "hard"}
ORIGINS = {"handwritten", "generated", "community"}

EXPLANATION_MIN, EXPLANATION_MAX = 10, 300
STATEMENT_MAX = 160          # longer than this is hard to read on stream in 10-15 seconds
ITEM_MAX = 40                # one Odd One Out option

FACT_KEY_RE = re.compile(r"^[a-z0-9]+(-[a-z0-9]+)*$")
SOURCE_RE = re.compile(r"^https?://\S+$")

# Words that usually mean a question only makes sense in one country.
# A match sends the question to "needs a look" instead of the batch.
REGIONAL_RE = re.compile(
    r"\b(our|we|here in|state of|county|congress|senate|NFL|NBA|MLB|NHL|Super Bowl|"
    r"Thanksgiving|Fourth of July|mph|Fahrenheit|°F)\b"
    # imperial units only count after a number ("300 feet"), so "four feet" on an elephant is fine
    r"|\d[\d,.]*\s*(miles?|feet|foot|ft|inches|pounds|lbs?|ounces|oz)\b",
    re.IGNORECASE,
)

# Near-duplicates: questions this alike (0..1) are flagged. For Odd One Out, 0.75 = 3 of 4 items shared.
SIMILARITY_LIMIT = 0.75

# Balance targets for the daily pool (from the build spec): 30% easy / 40% medium / 30% hard.
DIFFICULTY_TARGET = {1: 0.30, 2: 0.40, 3: 0.30}
