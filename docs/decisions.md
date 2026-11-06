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
| Nov 5, 2026 | Content pipeline: questions come from both generated real-world data (for volume and hard Odd One Out) and handwritten batches (for fun facts data can't produce) | Volume and variety, plus real data work for my portfolio |
| Nov 5, 2026 | Drafts go into the database through an "Import drafts" button on the admin page | No secret service key needed anywhere |
| Nov 5, 2026 | First batch: about 300 drafts | Real variety, still reviewable over a few sessions |
| Nov 5, 2026 | Start a small closed test with a few invited streamers before launch; the beta is a test, not the launch | Real streamers find problems I can't, while the "no launch until the backend is done" rule still holds |
| Nov 5, 2026 | Beta prep: streamers can report a bad question from the reveal screen; I handle reports and can retire live questions from the admin page | Mistakes get caught and pulled fast during the test |
| Nov 5, 2026 | Mizavo is invite-only during the closed test. I add streamers by Twitch name on the admin page, and one switch opens it to everyone later | Only the testers I chose can play |
| Nov 5, 2026 | Testers get a streamer setup guide page (login, OBS, chat commands, reporting, feedback) | Less hand-holding over DMs |
| Nov 5, 2026 | Testers send feedback in the Mizavo Discord (a never-expiring invite, linked from the guide) | One place for bug reports and ideas |
| Nov 5, 2026 | Simulated chat starts off for everyone | Real games by default; practice is opt-in |
| Nov 5, 2026 | The old name "Hivemind" comes out of the game text (I let Claude make this call): the 90% callout now says "In sync" and the chat-wins title says "Chat wins. The crowd was right." | No leftover old name for testers to trip on |
| Nov 5, 2026 | Testers can join the closed test with an invite link, without me approving each person. One link per friend (I let Claude pick the safest option); each link has a name, an optional max number of people, and an on/off switch | Friends can pass Mizavo to streamers they know, and if a link spreads too far I turn off just that one; people who already joined stay in |
| Nov 6, 2026 | Viewers' first answer counts; no switching | Stricter, and nobody can change their answer at the last second |
| Nov 6, 2026 | No `!play` join step: typing an answer in chat is how a viewer joins (like Marbles' `!play`, but the easiest option) | Fewer chat messages and nothing extra for viewers to learn |
| Nov 6, 2026 | Points will be a currency for ball skins, but spending them never lowers a player's points on leaderboards or ranks. Skins come only with the final release | Rewards without punishing players for spending |
| Nov 6, 2026 | We're in the testing phase, not a full release. Roadmaps and ideas from outside discussions (like ChatGPT) are guiding ideas only, not decisions | Only what's decided here gets built |
| Nov 6, 2026 | Redesign direction: dark "Ink & Cream" style (midnight blue-black, cream, muted blue and orange), all sans-serif, rounded 3D-looking balls (ready for skins later), and a launch screen where the balls form a white M-shaped scale (blue pan and orange pan) and then scatter. Replaces Night Edition once built | Testers said the old design was too much on the eyes |
