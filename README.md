# Triple Word

An online word game for you and two friends. One person creates a room, sends the link, and everyone plays from their own phone or laptop. Standard 15×15 board, 100 tiles, premium squares, blanks, 50-point bonus for using all seven tiles, and a dictionary check (168,000+ words).

## Deploy to Vercel (about 5 minutes)

The game needs a small database so all three players see the same board. Vercel's free Upstash Redis integration covers it.

1. **Put the code on GitHub.** Create a new repository and upload everything in this folder (keep the folder structure: `api/`, `lib/`, `public/`, `package.json`, `vercel.json`).
2. **Import it into Vercel.** Go to vercel.com → Add New → Project → pick the repository. Leave all settings as they are and click Deploy.
3. **Add storage.** In your new project, open the **Storage** tab → **Create Database** → choose **Upstash for Redis** (free plan) → connect it to this project. Vercel adds the connection settings automatically.
4. **Redeploy.** Go to **Deployments**, open the menu on the latest one, and choose **Redeploy** so it picks up the database.
5. Open your site, enter your name, create a room, and send the link to your friends.

> No GitHub? Install the Vercel CLI (`npm i -g vercel`), run `vercel` inside this folder, then do steps 3–4 and run `vercel --prod`.

If you see "Game storage isn't set up yet", step 3 or 4 hasn't happened.

The app reads either `KV_REST_API_URL` / `KV_REST_API_TOKEN` (what Vercel's integration adds) or `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` (if you make the database on upstash.com yourself).

## Run it on your computer

```bash
npm install
npm run dev        # http://localhost:3000 — open three browser windows to test
npm test           # rules and scoring checks
```

Locally, rooms live in memory, so no database is needed.

## How it works

- `public/` — the site: `index.html`, `styles.css`, `app.js` (UI), `engine.js` (rules and scoring, shared with the server).
- `api/game.js` — one serverless function. Every move is checked on the server; each player only ever receives their own tiles.
- `lib/game.js` — turns, drawing tiles, swaps, passes, end of game. `lib/store.js` — Redis storage with a short lock so two moves can't collide. `lib/words.js` — the ENABLE word list (public domain) plus modern two-letter words like QI, ZA, OK.
- Players see each other's moves within about 1.5 seconds. Rooms expire after a week without activity. If you close the tab, open the same link again on the same device to pick up where you left off.

## Rules used

- First word covers the centre star. Later words must connect to tiles already down.
- Every new word formed scores; bonus squares count only the turn they're covered. Blanks are worth 0.
- Swap needs at least 7 tiles in the bag. Pass skips your turn.
- The game ends when a player uses their last tile with the bag empty (they collect everyone's leftover tile values) or after six scoreless turns in a row. Leftover tiles are subtracted.
- The host can turn off the dictionary check in the lobby for house-rules games.
- Works with 2 or 3 players.
