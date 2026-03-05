# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
npm install       # install dependencies (express only)
node server.js    # run locally at http://localhost:3000
```

No build step, no transpilation, no test suite.

## Architecture

Single-page browser game served as static files via Express.

**Entry point:** `index.html` → loads `style.css` + `game.js`

**Server:** `server.js` — Express static file server. Reads `process.env.PORT` (set by Railway) or defaults to 3000.

**All game logic is in `game.js`:**

- **Grid** — `Uint8Array(COLS * ROWS)` (60×45 = 2700 cells). Values: `EMPTY=0`, `BORDER=1`, `TRAIL=2`. Accessed via `G(r,c)` / `setG(r,c,v)`.
- **Game loop** — `requestAnimationFrame` → `update(dt)` → `render()`. `dt` is capped at 100ms.
- **Player movement** — timer-based (one cell per `moveInterval` ms). Direction buffered in `player.nextDir`, applied each tick. 180° reversal blocked while on trail.
- **Fill algorithm** (`completeFill`) — when trail closes to border: (1) convert trail cells to BORDER, (2) BFS flood from each fuzzy's position through EMPTY cells marking them `unsafe`, (3) all remaining interior EMPTY cells → BORDER (claimed). Score scales with fill size.
- **Fuzzies** — bounce in straight lines through EMPTY; reflect off BORDER/walls; stepping on TRAIL kills the player.
- **Sparx** (level 2+) — travel along `perimeterCells[]` (pre-built clockwise outer ring); touching player on border kills the player.
- **Phases** — `'title' | 'playing' | 'dying' | 'levelclear' | 'gameover'`. Non-playing phases run `updateAnimation(dt)` only.
- **Level scaling** — player speed: `max(40, 100 - (level-1)*8)` ms/move; fuzzy count: `1 + level`; fuzzy speed: `max(60, 130 - (level-1)*15)` ms/move; Sparx added from level 2.

## Deployment

Railway auto-detects `"start": "node server.js"` in `package.json` and runs `npm install` + `npm start`. No environment variables required.

GitHub remote: `https://github.com/arigo56640-maker/Volfied-.git`
