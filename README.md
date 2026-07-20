# 🎲 MediaPicker

> **100% of the code in this repository was written by [Claude](https://claude.ai) (Anthropic's AI assistant). No human wrote any of the application code — every feature, bug fix, and architectural decision was implemented through conversation with Claude. Keep that in mind when evaluating it.**

---

MediaPicker is a self-hosted backlog manager and randomizer for people who can never decide what to watch, read, or play next. It tracks your backlog across seven media categories, randomly assigns items to slots so you always have something to pick from, and keeps tabs on what is currently airing.

---

## Features

### 🔐 Authentication

The login page has three options:

| Option | Description |
|---|---|
| 🎬 **Jellyfin** | Sign in with an existing Jellyfin server. Each Jellyfin user gets their own library, queue, slots, and settings. |
| 👤 **Local Account** | Register a username and password stored only on this server (bcrypt-hashed). Full per-user data isolation. |
| Anonymous | **Continue without account** — data stored under a shared `local` account. |

If `LOCAL_PASSCODE` is set in your environment, it acts as an **invite code** required for both local account registration and anonymous login — useful for keeping a public deployment controlled.

### 🎰 Slot randomizer
Each category has three slots filled randomly from your library. Per slot you can:
- **🔒 Lock** — keep the current item while rerolling the others
- **🎲 Reroll** — swap it for something else from the library
- **🔍 Pick manually** — search and assign a specific item
- **✓ Mark done** — sends the item to the finish counter and draws the next one; the item and its local cover file are deleted automatically
- **Progress tracking** — anime, manga, series, and comics slots have an episode/chapter counter
- **Notes** — a text field per slot for reminders or thoughts

### 📚 Seven categories
Movies · Series · Anime · Manga · Games · Comics · Albums — each with its own library, slots, queue, and finish counter.

### 📋 Queue mode
Enable queue mode per category and slots pull items in order from a hand-curated list instead of randomly. Build the queue manually or import via CSV. Toggle per category in **Settings → Queue Mode**.

### 📺 Currently Releasing
A live section showing everything you are actively following that is still airing. Syncs from AniList (anime/manga) and Simkl (TV shows). Ended and cancelled shows are filtered out automatically. Each tile shows episodes/chapters aired and a **👁 watched** counter you can type into directly.

### 🔢 Finish counter
A stats bar at the top shows how many items you have finished per category, plus a running total of episodes watched and chapters read.

### 🌐 Public profile
Any user can make their profile publicly viewable at `/user/username`. Enable it in **Settings → Profile** — a copyable link is shown. Visitors see your current randomized picks with cover art, progress, notes, and library counts. The page is fully read-only and private by default.

### 🖼️ Cover art

| Category | Source | API key needed |
|---|---|---|
| 🎮 Games | IGDB via Twitch | Yes — free at dev.twitch.tv |
| 💬 Comics | ComicVine | Yes — free at comicvine.gamespot.com/api |
| 🎵 Albums | iTunes / Deezer / MusicBrainz | No |
| ⛩️ Anime · 📚 Manga | AniList | No |
| 📺 Series · 🎬 Movies | Simkl | No |

Click **🖼 Covers** in the header to refresh covers for any category. The dropdown lets you pick which categories to update. Cover files are stored locally in your data folder and deleted automatically when the library item is removed.

ComicVine is rate-limited to 200 requests/hour on the free tier. The sync pauses and resumes automatically.

If ComicVine matches a comic to the wrong volume, open the **💬 Comics** library, click **✏** on the item, and enter the correct ComicVine volume ID in the **ComicVine ID** field — found in the URL on comicvine.gamespot.com. Click **Set ID & Resync** to fetch the correct cover immediately.

### 🗑️ Clear library
Each category header has a **🗑** button. First click turns red showing **⚠ Sure?** — click again within three seconds to wipe that category's library. Cover files are deleted from disk and slots are cleared.

### 🔔 Toast notifications
Bottom-left notifications confirm when syncs, imports, and cover fetches complete or fail.

---

## Tech stack

| Layer | Technology |
|---|---|
| Frontend | React 18, TypeScript, Vite |
| Backend | Node.js, Express |
| Database | SQLite via libsql (`@libsql/client`) |
| Container | Docker + Docker Compose |
| Auth | Jellyfin, local accounts (bcryptjs), anonymous |
| Security | Helmet, express-rate-limit, httpOnly cookies, SSRF protection |

---

## Running with Docker

### Prerequisites
- Docker Desktop
- A folder on your machine for persistent data (database and cover images live here)

### docker-compose.yml

```yaml
services:
  mediapicker:
    build: .
    ports:
      - "3000:3000"
    volumes:
      - /your/data/path:/data
    restart: unless-stopped
    environment:
      - PORT=3000
      - DATA_DIR=/data
      - NODE_ENV=production
      - ALLOWED_ORIGIN=https://yourdomain.com
      - LOCAL_PASSCODE=change-me
```

Replace `/your/data/path` with an absolute path to a folder on your machine.

| Variable | Required | Description |
|---|---|---|
| `NODE_ENV=production` | Recommended | Enables `Secure` flag on session cookies (HTTPS only) |
| `ALLOWED_ORIGIN` | Recommended | CORS origin restriction — set to your public domain |
| `LOCAL_PASSCODE` | Optional | Invite code required for anonymous login and local account registration. Remove it to allow open registration on a LAN. |

```bash
docker compose up --build -d
```

Open [http://localhost:3000](http://localhost:3000). You will be prompted to log in.

---

## API integrations

### AniList (anime + manga)
No API key required. Enter your AniList username in **Settings → Connections**. Syncs your watchlist and fetches airing schedules.

### Simkl (movies + series + anime)
1. Create a free app at [simkl.com/apps](https://simkl.com/apps) to get a Client ID.
2. Paste it in **Settings → Connections → Simkl**.
3. Click **Authorize via PIN** and follow the on-screen steps.

### MyAnimeList (anime + manga)
No API key required. Enter your MAL username in **Settings → Connections**. Profile must be public. Uses the Jikan API.

### IGDB (game covers)
1. Register a free app at [dev.twitch.tv/console](https://dev.twitch.tv/console).
2. Paste the **Client ID** and **Client Secret** in **Settings → Connections → IGDB**.
3. Click **🖼 Covers → 🎮 Games** in the header to fetch cover art.

### ComicVine (comic covers)
1. Get a free API key at [comicvine.gamespot.com/api](https://comicvine.gamespot.com/api/).
2. Paste it in **Settings → Connections → ComicVine**.
3. In the Comics library click **🎨 ComicVine Sync**.
4. Rate limit: 200 requests/hour. The sync pauses automatically and resumes after the window resets.
5. If a comic matched the wrong volume, use the **✏ → ComicVine ID** field to correct it.

### iTunes / Deezer / MusicBrainz (album covers)
No configuration needed. Click **🖼 Covers → 🎵 Albums**.

---

## CSV import

CSV import is available per category via the **📥 Import CSV** button in the library modal.

### Games (InfiniteBacklog)
```
IGDB ID,Game name,Game release date,...,Platform,Type,Status,Completion,...
315367,"LEGO Harry Potter Collection",2024-10-08,...,PlayStation 5,,Playing,Unfinished,...
```
Rows with `Completion = Completed` or `Beaten` are skipped unless `Status = Playing`. A platform and acquisition-type picker appears before confirming the import.

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
Any CSV with a `Title` or `Name` column. Optional columns: `thumbnail`, `Platform`, `Status`.

---

## Known limitations

- **⟳ Update** button is a work in progress — it runs but results may be incomplete.
- Simkl does not return per-episode totals from its API, so the watched counter in Currently Releasing won't show a `/total` denominator for Simkl-sourced shows.
- ComicVine matches on series title only — generic names like "Batman" may match the wrong volume. Use the **ComicVine ID** field to correct mismatches.
- The `local` account is shared — multiple people using the instance without a personal account will see the same data.

---

## License

No license — personal project, use at your own risk.
