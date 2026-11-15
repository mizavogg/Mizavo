# Mizavo

A free browser trivia game. Twitch streamers play against their own chat on worldwide general-knowledge questions (Fact or Fake, Odd One Out), and every chat answer drops in as a ball. There's also a daily challenge: 10 questions, the same for everyone in the world.

The name comes from the Arabic word *mizan* (ميزان): balance, scale, measuring instrument.

Live site: https://mizavo.gg

## Repo layout

```
web/                    the website (Vite + TypeScript)
  index.html            game page: logged-out preview, setup, game, results
  admin.html            admin page: review drafts, retire live questions, handle reports, manage closed-test invites; import batches; download the bank
  guide.html            streamer setup guide (login, OBS, chat commands, reporting)
  solo.html, today.html, channel.html, privacy.html, warmup.html, family.html, 404.html
                        daily challenge, leaderboards, channel pages, privacy & terms, Starting Soon panel, family login, not found
  src/styles/           theme.css (shared Ink & Cream look) plus one stylesheet per page
  src/lib/              supabase.ts (database connection + login), dom.ts (small helpers)
  src/game/
    main.ts             login, settings, buttons and keys: everything starts here
    flow.ts             game flow: start, rounds, timer, reveal, results, resume, end game
    api.ts              the game's database calls, with their exact shapes
    state.ts            the shared game state and types
    arena.ts            vote dots, bins, physics, canvas drawing
    chat.ts             reading answers from Twitch chat in the browser (the server also reads chat, through mizavobot)
    demo.ts             simulated viewers (games with them are saved as test games)
    attract.ts          the looping preview shown to logged-out visitors
    streamer-mode.ts    clear space on the right for a webcam + chat overlay
  src/admin/main.ts     admin page logic
  vite.config.ts        build settings (one entry per page)
pipeline/               content pipeline (Python + pandas): builds and checks draft questions
  build.py              run this; see pipeline/README.md
  mizavo_pipeline/      rules, checks, templates, report
  tests/                tests for the checks
supabase/
  migrations/           database: every change, numbered, all applied live
  functions/            Edge Functions: twitch-chat, twitch-avatars, send-reminders, twitch-bot-connect
docs/
  decisions.md          product decisions, in order
```

Questions are never stored in this repo. They live only in Supabase, and the game receives one question at a time, without its answer, until the round is revealed.

The pipeline's data, inputs and outputs stay out of the repo for the same reason. Added later: `analytics/` (SQL + Tableau).

## Run locally

```
cd web
npm install
npm run dev        # local preview at http://localhost:5173
npm run check      # type-check only
```

Twitch login only works on the live address (it's the only one Supabase allows), so test logged-in features there.

## Deploy

```
cd web
npm run build      # type-checks, then writes the finished site to web/dist/
```

Zip the **contents** of `web/dist/` and upload them to the Cloudflare Worker "mizavo".

## Tech

Supabase (Postgres, Auth with Twitch login, Edge Functions, pg_cron) · Cloudflare · Vite + TypeScript client · Python + pandas content pipeline · Tableau/Excel analytics.

Built by Aiden Jajo, with AI assistance (Claude) for code.
