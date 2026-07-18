# 🎲 MediaPicker

> **100% of the code in this repository was written by [Claude](https://claude.ai) (Anthropic's AI assistant). No human wrote any of the application code — every feature, bug fix, and architectural decision was implemented through conversation with Claude. Keep that in mind when evaluating it.**

---

MediaPicker is a self-hosted backlog manager and randomizer for people who can never decide what to watch, read, or play next. It tracks your backlog across seven media categories, randomly assigns items to slots so you always have something to pick from, and keeps tabs on what is currently airing.

---

## Features

### 🎰 Slot randomizer
Each category has three slots filled randomly from your library. Lock a slot to keep its item while rerolling the others. Mark a slot done to move the item to your finished counter and immediately draw the next one.

### 📚 Seven categories
Movies · Series · Anime · Manga · Games · Comics · Albums — each with its own library, queue, slots, and finish counter.

### 📋 Queue mode
Enable queue mode per category and the slots pull items in order from a hand-curated list instead of randomly. Import a whole queue via CSV or build it manually.

### 📺 Currently Releasing
A live section showing everything you are actively watching that is still airing. Syncs automatically from AniList (anime/manga) and Simkl (TV shows). Only shows content that is actually still releasing — ended and cancelled shows are filtered out. Each tile shows:
- Episodes/chapters aired (from the API)
- A **👁 watched** counter you can type into directly

### 🔢 Finish counter
A stats bar always visible at the top shows how many items you have finished in each category, plus total episodes watched and chapters read.

### 🖼️ Cover art
| Category | Source | API key needed |
|---|---|---|
| 🎮 Games | IGDB (via Twitch) | Yes — free at dev.twitch.tv |
| 💬 Comics | ComicVine | Yes — free at comicvine.gamespot.com/api |
| 🎵 Albums | iTunes Search API | No |

### 📥 CSV import
Import your entire backlog from exports of tracking sites. The importer handles:
- **Games**: InfiniteBacklog / Backloggery exports. Skips completed/beaten entries. Platform filter lets you select which platforms to import before the rows hit the database.
- **Comics**: CLZ / ComicBase exports. Strips issue numbers (`#1`, `#12` …) and deduplicates to one row per series. Skips already-read issues.
- **Albums**: Any CSV with `Artist`, `Album`, `Year` columns (e.g. RateYourMusic exports).
- **Everything else**: any CSV with a `Title` or `Name` column.

### 🔔 Toast notifications
Bottom-left notifications show what is happening (syncing, importing, fetching covers) and confirm when it finishes or fails.

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite |
| Backend | Node.js, Express |
| Database | SQLite via libsql (`@libsql/client`) |
| Container | Docker + Docker Compose |
| Image registry | GitHub Container Registry (GHCR) |

---

## Running with Docker

### Prerequisites
- Docker Desktop
- A folder for persistent data (the database lives here between container restarts)

### docker-compose.yml

```yaml
services:
  mediapicker:
    image: ghcr.io/coolscribble/mediapicker:latest
    ports:
      - "3000:3000"
    volumes:
      - /your/data/path:/data
    restart: unless-stopped
```

Replace `/your/data/path` with a folder on your machine, then:

```bash
docker compose up -d
```

Open [http://localhost:3000](http://localhost:3000).

### Building from source

```bash
git clone https://github.com/coolscribble/MediaSelection.git
cd MediaSelection
docker compose up --build -d
```

---

## API integrations

### AniList (anime + manga)
No API key required. Enter your AniList username in **Settings → Connections**. Syncs your current watching/reading list and fetches airing schedules.

### Simkl (movies + series + anime)
1. Create a free app at [simkl.com/apps](https://simkl.com/apps) to get a Client ID.
2. Paste the Client ID in **Settings → Connections → Simkl**.
3. Click **Authorize via PIN** and follow the on-screen steps.

### MyAnimeList (anime + manga)
No API key required. Enter your MAL username in **Settings → Connections**. Profile must be set to public.

### IGDB (game covers)
1. Register a free app at [dev.twitch.tv/console](https://dev.twitch.tv/console).
2. Paste the **Client ID** and **Client Secret** in **Settings → Connections → IGDB**.
3. Click **🎮 Covers** in the header to fetch cover art for all games in your library.

### ComicVine (comic covers)
1. Get a free API key at [comicvine.gamespot.com/api](https://comicvine.gamespot.com/api/).
2. Paste it in **Settings → Connections → ComicVine**.
3. Click **💬 Covers** to fetch volume cover art.

### iTunes / Albums
No configuration needed. Click **🎵 Covers** after importing albums and artwork is fetched automatically from the iTunes Search API.

---

## CSV import formats

### Games (InfiniteBacklog)
```
Game name,Platform,Completion,IGDB ID,...
Hades,PC,Playing,1145360,...
```
Rows with `Completion = Completed` or `Beaten` are skipped automatically. After picking the file, platform checkboxes let you import only specific platforms.

### Comics (CLZ / ComicBase)
```
Publisher Name,Series Name,Full Title,Release Date,Marked Read,...
Marvel,Spider-Man,Spider-Man #1,1990-08-01,0,...
```
`Marked Read = 1` rows are skipped. Series names are deduplicated so each volume appears once.

### Albums
```
Artist,Album,Year
Charli XCX,BRAT,2024
slowthai,UGLY,2023
```

### Everything else
Any CSV with a `Title` or `Name` column. Optional: `thumbnail`, `Platform`, `Status`.

---

## Roadmap / known limitations

- Simkl episode counts are not available from the API (only airing status); the watched counter still works, it just won't show a `/total` denominator for Simkl-sourced shows.
- ComicVine search matches on title only; very generic series names (e.g. "Batman") will match the most popular result which may not be the exact volume you mean.
- iTunes cover search works best when both artist and album name are in the CSV.

---

## License

No license — personal project, use at your own risk.
