# 🎲 MediaPicker

> **100% of the code in this repository was written by [Claude](https://claude.ai) (Anthropic's AI assistant). No human wrote any of the application code — every feature, bug fix, and architectural decision was implemented through conversation with Claude. Keep that in mind when evaluating it.**

---

MediaPicker is a self-hosted backlog manager and randomizer for people who can never decide what to watch, read, or play next. It tracks your backlog across seven media categories, randomly fills slots so you always have something queued up, and pulls live data from the services you already use.

---

## Setup

```yaml
# docker-compose.yml
services:
  mediapicker:
    image: ghcr.io/lilcipra/mediapicker:latest
    ports:
      - "3000:3000"
    volumes:
      - /path/to/data:/data
    environment:
      - JWT_SECRET=your-secret-here
    restart: unless-stopped
```

```bash
docker compose up -d
# Open http://localhost:3000
```

---

## Features

### 🔐 Authentication

| Option | Description |
|---|---|
| 🎬 **Jellyfin** | Sign in with an existing Jellyfin server. Each Jellyfin user gets their own isolated library, slots, and settings. |
| 👤 **Local Account** | Register a username and password stored on this server (bcrypt-hashed). Multi-user supported. |
| 🔗 **Public Profile** | Optional read-only profile page at `/user/<username>` shareable with others. |

---

### 🗂 Media Categories

Seven categories, each fully independent with its own library, slots, queue, and stats:

| Icon | Category | Notes |
|---|---|---|
| 🎬 | **Movies** | TMDB integration, Simkl sync, collection auto-detect |
| 📺 | **Series** | Simkl sync, episode tracking, airing status |
| ⛩️ | **Anime** | AniList + MAL sync, episode tracking, collection auto-detect |
| 📚 | **Manga** | AniList + MAL sync, chapter tracking |
| 🎮 | **Games** | IGDB covers, HLTB time estimates, Steam/PSN/Xbox/RA import |
| 💬 | **Comics** | ComicVine covers, chapter tracking |
| 🎵 | **Albums** | iTunes cover art |

You can hide any category from the main page, library, and collections via **Settings → Display**.

---

### 🎲 Slots

Each category has **3 random slots** filled from your library. Slots are your active picks — whatever is in a slot is what you should be doing next.

| Action | Description |
|---|---|
| 🔒 **Lock** | Keep this item in the slot; it won't be replaced on reroll |
| 🔀 **Reroll** | Pick a new random item from the library (unlocked slots only) |
| 🔍 **Manual select** | Search your library and assign a specific item |
| ✅ **Complete** | Mark done — item moves to stats, slot opens up |
| 📝 **Note** | Attach a freeform note to the slot |
| 📊 **Progress** | Track episodes, chapters, or hours directly on the slot |

---

### 📋 Queue Mode

Enable per-category in **Settings → Queue**. When active, completing a slot automatically pulls in the next item from the queue instead of rerolling randomly. Items in the queue can be reordered by drag-and-drop.

---

### ⚡ XP & Leveling

Completing items earns XP shown in the bar at the top of the screen. The level curve is exponential (`100 × 1.4^(level-1)` XP per level).

| Category | XP per completion |
|---|---|
| Movies | 120 XP flat |
| Series | 30 XP per episode |
| Anime | 15 XP per episode |
| Manga | 1 XP per chapter |
| Games | 40 XP per HLTB hour (min 120 XP) |
| Comics | 1 XP per chapter |
| Albums | 40 XP flat |

Completing an entire **Collection** awards a bonus on top of the individual item XP.

---

### 📡 Ongoing Tracker

A separate section below the main grid shows currently airing series, anime, and manga with live episode counts and next-air-date countdowns. Syncs from AniList (anime/manga) and Simkl (TV shows).

---

### 🗂 Collections

Group related items into franchises or series. Collections appear on the Collections page with a completion progress bar.

| Feature | Description |
|---|---|
| **Manual** | Create a collection, add items from your library |
| **Auto-detect Movies** | Finds TMDB movie collections across your movie library |
| **Auto-detect Anime** | Uses the AniList relations graph (BFS over SEQUEL/PREQUEL/PARENT/SIDE_STORY links) to find franchise groups |

---

### 📥 Importing Your Library

#### Sync from tracking services

Open **⟳ Sync** from the header to pull your lists from:

| Service | Categories | Notes |
|---|---|---|
| **AniList** | Anime, Manga | Choose which statuses to import (Planning, Watching, Completed, etc.) |
| **MyAnimeList** | Anime, Manga | Via Jikan public API — no API key needed |
| **Simkl** | Movies, TV Shows, Anime | OAuth login required; choose which statuses to import |
| **TMDB** | Movies | Imports your TMDB watchlist; OAuth session required |
| **Steam** | Games | Steam ID + session cookie; fetches full library |
| **PlayStation (PSN)** | Games | PSN ID sync |
| **Xbox** | Games | Gamertag lookup via xbl.io API key |
| **RetroAchievements** | Games | Imports your RA game library with achievement progress |

#### CSV Import

Library → Upload CSV. Works with exports from:

- **InfiniteBacklog** (games — platform and acquisition type filters included)
- **Letterboxd** (movies)
- **Trakt** (movies, series)
- Any CSV with a `title` column

For game CSVs, an optional platform filter lets you include only specific systems. An acquisition type filter (Steam, PSN, Physical, etc.) lets you narrow to specific storefronts.

#### Manual Add

Type a title and optional thumbnail URL directly in the Library page.

---

### 🖼 Cover Art

Covers are fetched from category-appropriate APIs and optionally cached locally on your server.

| Category | Cover source |
|---|---|
| Games | IGDB (requires Client ID + Secret) |
| Albums | iTunes Search API (no key needed) |
| Comics | ComicVine (API key required) |
| Anime / Manga | AniList |
| Movies / Series | Simkl |

Use **🖼 Covers ▾** in the header to refresh covers for selected categories. Individual covers can also be set via URL or by uploading an image file in the Library view.

---

### 🏆 RetroAchievements Integration

Import your RA game library with per-game achievement progress displayed on slot cards (`🏆 earned/total (pct%)`). Options:

- **Skip 100% mastered** — don't import games you've fully completed
- **Skip beaten** — don't import games you've officially beaten

Configure in **Settings → Connections → RetroAchievements**.

---

### ⚙ Settings

| Tab | Options |
|---|---|
| **Profile** | Username display, public profile toggle |
| **Display** | Show/hide individual categories across the whole app |
| **Queue** | Enable queue mode per category |
| **Connections** | API keys: IGDB, ComicVine, TMDB, Xbox, RetroAchievements; sync credentials: Simkl, AniList username, MAL username, Steam ID, RA username |
| **Import/Sync** | Configure which statuses to import from AniList, Simkl, and MAL |

---

### 📊 Stats

The stats bar below the header shows total completions per visible category with episode/chapter counts. The XP bar at the very top tracks your level progress. The full stats screen (accessible via the XP bar) shows per-category breakdowns and total game hours tracked via HLTB.
