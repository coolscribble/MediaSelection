# 🎲 MediaPicker

> **100% of the code in this repository was written by [Claude](https://claude.ai) (Anthropic's AI assistant). No human wrote any of the application code — every feature, bug fix, and architectural decision was implemented through conversation with Claude. Keep that in mind when evaluating it.**

---

MediaPicker is a self-hosted backlog manager and randomizer for people who can never decide what to watch, read, or play next. It tracks your backlog across seven media categories, randomly assigns items to slots so you always have something to pick from, and keeps tabs on what is currently airing.

---

## Features

### 🎰 Slot randomizer
Each category has three slots filled randomly from your library. Per slot you can:
- **🔒 Lock** — keep the current item while rerolling the others
- **🎲 Reroll** — swap it for something else from the library
- **🔍 Pick manually** — search and assign a specific item from your library
- **✓ Mark done** — sends the item to the finish counter and immediately draws the next one
- **Progress tracking** — anime, manga, series, and comics slots have an episode/chapter counter you can increment or type into directly
- **Notes** — a text field per slot for reminders or thoughts

### 📚 Seven categories
Movies · Series · Anime · Manga · Games · Comics · Albums — each with its own library, slots, queue, and finish counter.

### 📋 Queue mode
Enable queue mode per category and the slots pull items in order from a hand-curated list instead of randomly. Build the queue manually or import it via CSV. Toggle per category in **Settings → Queue Mode**.

### 📺 Currently Releasing
A live section showing everything you are actively following that is still airing. Syncs from AniList (anime/manga) and Simkl (TV shows). Only shows content that is actually still releasing — ended and cancelled shows are filtered out automatically on sync. Each tile shows:
- Episodes/chapters aired (from the API, where available)
- A **👁 watched** counter you can type into directly — no need to tap + repeatedly

### 🔢 Finish counter
A stats bar always visible at the top shows how many items you have finished in each category, plus a running total of episodes watched and chapters read.

### 🖼️ Cover art
| Category | Source | Needs API key |
|---|---|---|
| 🎮 Games | IGDB via Twitch | Yes — free at dev.twitch.tv |
| 💬 Comics | ComicVine | Yes — free at comicvine.gamespot.com/api |
| 🎵 Albums | iTunes Search API | No |

Movies, series, anime, and manga covers come from Simkl / AniList during sync.

### 📥 CSV import
Import your entire backlog from exports of tracking sites. The importer handles:
- **Games**: InfiniteBacklog / Backloggery exports. Skips `Completed` and `Beaten` rows. After picking the file, platform checkboxes appear so you can select only the platforms you want before the rows are written to the database.
- **Comics**: CLZ / ComicBase exports. Strips issue numbers (`#1`, `#12` …) and deduplicates to one row per series. Skips already-read issues (`Marked Read = 1`).
- **Albums**: Any CSV with `Artist`, `Album`, and `Year` columns (e.g. RateYourMusic exports).
- **Everything else**: any CSV with a `Title` or `Name` column. Optional: `thumbnail`, `Platform`, `Status`.

### 🗑️ Clear library
Each category header has a **🗑** button. First click turns it red showing **⚠ Sure?** — click again within three seconds to wipe the entire library for that category. Slots are cleared automatically. The button resets on its own if you change your mind.

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
- A folder on your machine for persistent data (the database lives here between restarts)

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

Replace `/your/data/path` with an absolute path to a folder on your machine, then:

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
No API key required. Enter your MAL username in **Settings → Connections**. Profile must be set to public. Uses the Jikan public API.

### IGDB (game covers)
1. Register a free app at [dev.twitch.tv/console](https://dev.twitch.tv/console).
2. Paste the **Client ID** and **Client Secret** in **Settings → Connections → IGDB**.
3. Click **🎮 Covers** in the header to fetch cover art for all games in your library. Uses your CSV's IGDB ID column for exact matching when available, falls back to title search.

### ComicVine (comic covers)
1. Get a free API key at [comicvine.gamespot.com/api](https://comicvine.gamespot.com/api/).
2. Paste it in **Settings → Connections → ComicVine**.
3. Click **💬 Covers** to fetch volume cover art.

### iTunes / Albums
No configuration needed. Click **🎵 Covers** after importing albums and artwork is fetched automatically from the iTunes Search API using the artist and album name from your CSV.

### ⟳ Update
The **⟳ Update** button in the header refreshes episode counts and airing dates from AniList and Simkl for everything in your library, and re-runs IGDB cover sync if credentials are configured.

---

## CSV import formats

### Games (InfiniteBacklog)
```
IGDB ID,Game name,Game release date,...,Platform,Type,Status,Completion,...
315367,"LEGO Harry Potter Collection",2024-10-08,...,PlayStation 5,,Playing,Unfinished,...
```
Rows with `Completion = Completed` or `Beaten` are skipped **unless** the `Status` column says `Playing` (e.g. you are replaying a finished game). The filter is case-insensitive. After picking the file a platform picker appears — uncheck any platforms you don't want to import.

### Comics (CLZ / ComicBase)
```
Publisher Name,Series Name,Full Title,Release Date,Marked Read,...
Marvel,Spider-Man,Spider-Man #1,1990-08-01,0,...
```
`Marked Read = 1` rows are skipped. Issue numbers are stripped and series names deduplicated so each volume appears once regardless of how many issues are in the export.

### Albums
```
Artist,Album,Year
Charli XCX,BRAT,2024
slowthai,UGLY,2023
```

### Everything else
Any CSV with a `Title` or `Name` column. Optional extras: `thumbnail`, `Platform`, `Status`.

---

## Known limitations

- Simkl does not return per-episode counts from its API, only airing status. The **👁 watched** counter in Currently Releasing works, but won't show a `/total` denominator for Simkl-sourced shows.
- ComicVine search matches on series title only. Generic names (e.g. "Batman") will match the most popular result, which may not be the exact volume you mean.
- iTunes cover search works best when both artist and album name are present in the CSV.

---

## License

No license — personal project, use at your own risk.
