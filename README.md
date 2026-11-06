# Mizavo

A browser game for Twitch streamers: the streamer plays against their own chat on worldwide general-knowledge questions (Fact or Fake, Odd One Out). Every chat vote becomes a dot that drops into its answer.

The name comes from the Arabic word *mizan* (ميزان): balance, scale, measuring instrument.

Live site: https://mizavo.mizavogg.workers.dev

## Repo layout

```
web/                  everything the website serves (uploaded to Cloudflare)
  index.html          the game page (layout only)
  login-test.html     Twitch login test page
  css/style.css       all styling ("Night Edition" look)
  js/questions.js     question list (temporary, until questions load from Supabase)
  js/helpers.js       shared helpers, colors, game state
  js/streamer-mode.js clear space on the right for a webcam + chat overlay
  js/arena.js         vote dots, bins, physics, canvas drawing
  js/game.js          rounds, timer, reveal, final results
  js/chat.js          reading votes from Twitch chat (anonymous, read-only)
  js/demo.js          simulated viewers for testing
  js/main.js          connects buttons, keys and settings, starts the game
supabase/
  migrations/         database: tables, game API, nightly pool builder, admin tools, Twitch login
docs/
  decisions.md        product decisions, in order
```

Folders added later, when their work starts: `content/` (question source files), `pipeline/` (Python + pandas), `analytics/` (SQL + Tableau).

## Run locally

Open `web/index.html` in a browser. No build step yet. The scripts in `web/js/` load in the order listed above, and later files use things from earlier ones, so keep that order.

## Deploy

Zip the **contents** of `web/` (not the folder itself) and upload to the Cloudflare Worker "mizavo".

## Tech

Supabase (Postgres, Auth with Twitch login, Edge Functions, pg_cron) · Cloudflare · HTML/CSS/JavaScript client (moving to Vite + TypeScript) · Python + pandas content pipeline · Tableau/Excel analytics.

Built by Aiden Jajo, with AI assistance (Claude) for code.
