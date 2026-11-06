# Mizavo — Decisions Log

Every product decision, newest at the bottom.

| Date | Decision | Why |
|---|---|---|
| Oct 2026 | Rejected "Ballpark" (number-guessing slider game) | Didn't feel right |
| Oct 2026 | Worldwide general-knowledge content only | Streamers and chat can be anywhere |
| Oct 2026 | Votes show as glowing orbs flying into answer bins | Chat needs something fun to watch |
| Oct 2026 | Modes: Fact or Fake, Odd One Out, Mix | Fun, quick, customizable |
| Oct 2026 | No question ever repeats for a channel | Returning viewers shouldn't see reruns |
| Oct 2026 | Daily pool of 200 questions, a different seeded version per streamer (30% easy / 40% medium / 30% hard) | Like different versions of the same test in one class |
| Oct 2026 | Every question needs a source and my approval | Accuracy and trust |
| Oct 2026 | No launch until the whole backend is done | No shortcuts I'd have to redo |
| Nov 4, 2026 | Renamed the game from Hivemind to Mizavo | |
| Nov 4, 2026 | New way of working: Claude does the work, I confirm before each next step | Faster, and I'm fine with it taking longer if it's done right the first time |
| Nov 4, 2026 | Supabase database in East US; new tables are not exposed to the internet by default | Tables stay locked until we allow access |
| Nov 4, 2026 | Questions table stores a category (9 topics) and a language (English for now) | Lets streamers pick topics and lets us add languages later without redoing the table (Claude's pick, at my request) |
| Nov 4, 2026 | Browsers can never read the questions table directly | Answers can't be peeked before the reveal |
| Nov 4, 2026 | A "day" starts at midnight UTC (4 pm Pacific) | Every streamer worldwide shares the same daily pool at the same moment |
| Nov 4, 2026 | Game API built as database functions (called with `supabase.rpc`) instead of separate Edge Functions | Each step runs in one locked transaction next to the data, so rules like no-repeats can't be skipped (Claude's pick, at my request) |
| Nov 4, 2026 | A round can be revealed early only after the streamer locks in a pick; otherwise it waits for the timer | Matches the prototype's Enter-to-reveal, and nobody can see the answer before committing (Claude's default, open to change) |
| Nov 4, 2026 | Only a human admin can approve questions; the content pipeline can only add drafts | Every question needs my approval before it can be played |
| Nov 4, 2026 | Approved questions are frozen; fix mistakes by retiring and adding a corrected draft | Old game records always stay accurate |
| Nov 4, 2026 | Hosting on Cloudflare (free, unlimited traffic) at mizavo.mizavogg.workers.dev | Free with no traffic cap if lots of viewers load the game |
| Nov 5, 2026 | Twitch login: streamers without an email are allowed | Channels are tied to the Twitch ID, not email |
| Nov 5, 2026 | Visual style is "Night Edition": a dark printed-zine look (ink black, cream, print blue and pink; Archivo Black and IBM Plex Mono fonts) | The old look felt like a generic AI webpage; this feels like its own thing and sits well next to streamers' overlays |
| Nov 5, 2026 | Streamer mode: off by default. When on, it leaves adjustable clear space on the right (12–45% of the screen) for a webcam and chat overlay. The game never shrinks below 720px, and the space matches the background. The switch lives on the setup screen | Streamers can show their cam and chat without covering the game |
| Nov 5, 2026 | Game code split into separate files (page, styles, scripts); repo organized into web/, supabase/, docs/ | Clean, organized and easy to keep running smoothly |
| Nov 5, 2026 | GitHub repo is public | Portfolio project; the database is protected by its access rules, not by hiding the code |
| Nov 5, 2026 | Question content never goes in the public repo. Real questions live only in Supabase; the test questions come out of the code when the game connects to the database | Viewers could read the answers |
| Nov 5, 2026 | Logged-out visitors see a "Log in with Twitch to play" panel over a looping demo of votes pouring in; questions only load for logged-in streamers | The site still looks alive to curious viewers, and answers never reach anyone who isn't playing |
| Nov 5, 2026 | Simulated chat stays for now (I'll remove it eventually). Games played with it are saved as test games: fake votes never touch question stats or the daily numbers, while real viewers who vote still get their points | Handy for testing and practice without skewing real data |
| Nov 5, 2026 | The game now gets its questions from the database one round at a time, and the answer only after the reveal; the test questions are out of the code | No answers in the public repo or in the page |
| Nov 5, 2026 | Client moved to Vite + TypeScript, as planned in the tech stack | Catches mistakes before they reach players; the deploy is still one zip |
