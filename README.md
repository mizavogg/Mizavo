# Mizavo

A browser game for Twitch streamers: the streamer plays against their own chat on worldwide general-knowledge questions (Fact or Fake, Odd One Out). Every chat vote becomes a dot that drops into its answer.

The name comes from the Arabic word *mizan* (ميزان): balance, scale, measuring instrument.

Live site: https://mizavo.mizavogg.workers.dev

## Repo layout

```
web/                  everything the website serves (uploaded to Cloudflare)
  index.html          the game page (layout only)
  admin.html          admin page: review, approve, edit or retire draft questions (admins only)
  login-test.html     Twitch login test page
  css/theme.css       shared "Night Edition" look: colors, fonts, header, buttons
  css/style.css       game page styles
  css/admin.css       admin page styles
  js/questions.js     question list (temporary, until questions load from Supabase)
  js/helpers.js       shared helpers, colors, game state
  js/streamer-mode.js clear space on the right for a webcam + chat overlay
  js/arena.js         vote dots, bins, physics, canvas drawing
  js/game.js          rounds, timer, reveal, final results
  js/chat.js          reading votes from Twitch chat (anonymous, read-only)
  js/demo.js          simulated viewers for testing
  js/main.js          connects buttons, keys and settings, starts the game
  js/supabase.js      shared database connection (for pages that log in)
  js/admin.js         admin page logic
supabase/
  migrations/         database: tables, game API, nightly pool builder, admin tools, Twitch login
docs/
  decisions.md        product decisions, in order
```

Folders added later, when their work starts: `content/` (question source files), `pipeline/` (Python + pandas), `analytics/` (SQL + Tableau).

## Run locally

Open `web/index.html` in a browser. No build step yet. The game's scripts load in the order listed above (questions.js through main.js), and later files use things from earlier ones, so keep that order. The admin page needs a real web address for Twitch login, so test it on the live site.

## Deploy

Zip the **contents** of `web/` (not the folder itself) and upload to the Cloudflare Worker "mizavo".

## Tech

Supabase (Postgres, Auth with Twitch login, Edge Functions, pg_cron) · Cloudflare · HTML/CSS/JavaScript client (moving to Vite + TypeScript) · Python + pandas content pipeline · Tableau/Excel analytics.

Built by Aiden Jajo, with AI assistance (Claude) for code.
