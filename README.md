# 🎲 MediaPicker

> **100% of the code in this repository was written by [Claude](https://claude.ai) (Anthropic's AI assistant). No human wrote any of the application code — every feature, bug fix, and architectural decision was implemented through conversation with Claude. Keep that in mind when evaluating it.**

---

MediaPicker is a self-hosted backlog manager and randomizer for people who can never decide what to watch, read, or play next. It tracks your backlog across seven media categories, randomly assigns items to slots so you always have something to pick from, and keeps tabs on what is currently airing.

---

## Features

### 🔐 Authentication
Sign in with your **Jellyfin** account (enter your server URL, username, and password) or click **Continue without Jellyfin** to use a persistent local account — no Jellyfin installation required. Each Jellyfin user gets their own separate library, queue, slots, and settings. The local option stores data under a shared `local` account.

### 🎰 Slot randomizer
Each category has three slots filled randomly from your library. Per slot you can:
- **🔒 Lock** — keep the current item while rerolling the others
- **🎲 Reroll** — swap it for something else from the library
- **🔍 Pick manually** — search and assign a specific item from your library
- **✓ Mark done** — sends the item to the finish counter and immediately draws the next one. The item and its cover file are deleted automatically.
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
| 🎵 Albums | MusicBrainz / Deezer / iTunes | No |
| ⛩️ Anime / 📚 Manga | AniList (on sync) | No |
| 🎬 Movies / 📺 Series | Simkl (on sync) | No |

Cover files are stored locally in your data folder and deleted automatically when the library item is removed.

ComicVine is rate-limited to 200 requests/hour on the free tier. The sync automatically pauses and resumes when the limit is reached, and skips items that already have a cover.

### 🗑️ Clear library
Each category header has a **🗑** button. First click turns it red showing **⚠ Sure?** — click again within three seconds to wipe the entire library for that category. Cover files for removed items are deleted from disk. Slots are cleared automatically.

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
| Auth | Jellyfin (`/Users/AuthenticateByName`) or local account |

---

## Running with Docker

### Prerequisites
- Docker Desktop
- A folder on your machine for persistent data (the database and cover images live here)

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

Open [http://localhost:3000](http://localhost:3000). You will be prompted to log in.

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
3. Click **🖼 Covers → Games** in the header to fetch cover art for all games in your library.

### ComicVine (comic covers)
1. Get a free API key at [comicvine.gamespot.com/api](https://comicvine.gamespot.com/api/).
2. Paste it in **Settings → Connections → ComicVine**.
3. Click **🖼 Covers → Comics** in the header.
4. The free tier allows 200 requests/hour. The sync pauses automatically when the limit is close and resumes after the window resets. Items that already have a cover are skipped.

### iTunes / Deezer / MusicBrainz (album covers)
No configuration needed. Click **🖼 Covers → Albums** and artwork is fetched automatically.

---

## CSV import

CSV import is available per category in **Settings → Import**. Covers are preserved across re-imports — if a cached cover exists for an item, it is reused without re-downloading.

### Games (InfiniteBacklog)
```
IGDB ID,Game name,Game release date,...,Platform,Type,Status,Completion,...
315367,"LEGO Harry Potter Collection",2024-10-08,...,PlayStation 5,,Playing,Unfinished,...
```
Rows with `Completion = Completed` or `Beaten` are skipped unless the `Status` column says `Playing`. After picking the file a platform picker appears — uncheck platforms you don't want to import. You can also filter by acquisition type (Steam, PSN, Physical, etc.) if the CSV has that column.

### Comics (CLZ / ComicBase)
```
Publisher Name,Series Name,Full Title,Release Date,Marked Read,...
Marvel,Spider-Man,Spider-Man #1,1990-08-01,0,...
```
`Marked Read = 1` rows are skipped. Issue numbers are stripped and series deduplicated so each volume appears once.

### Albums (RateYourMusic / generic)
```
Artist,Album,Year
Charli XCX,BRAT,2024
slowthai,UGLY,2023
```

### Everything else
Any CSV with a `Title` or `Name` column. Optional: `thumbnail`, `Platform`, `Status`.

---

## Known limitations

- **⟳ Update** button in the header is a work in progress — it runs but results may be incomplete.
- Simkl does not return per-episode counts from its API, only airing status. The watched counter in Currently Releasing works but won't show a `/total` denominator for Simkl-sourced shows.
- ComicVine search matches on series title only. Generic names like "Batman" will match the most popular result, which may not be the exact volume you mean.
- The `local` account is shared — if multiple people use the same instance without Jellyfin they will share the same data.

---

## License

No license — personal project, use at your own risk.
