const express = require('express')
const router = express.Router()
const { db } = require('../database')
const { simklQS, simklHeaders } = require('../services/simkl')

const ANILIST_API = 'https://graphql.anilist.co'
const ANILIST_QUERY = `
query ($userName: String, $type: MediaType, $status: MediaListStatus) {
  MediaListCollection(userName: $userName, type: $type, status: $status) {
    lists { entries { media {
      id title { romaji english } coverImage { medium } format
      episodes status
      nextAiringEpisode { airingAt episode }
    }}}
  }
}`

function buildAiringInfo(m) {
  if (m.nextAiringEpisode) {
    return JSON.stringify({
      episodes_aired: m.nextAiringEpisode.episode - 1,
      total_episodes: m.episodes || null,
      next_episode: m.nextAiringEpisode.episode,
      next_air_time: m.nextAiringEpisode.airingAt * 1000,
    })
  }
  if (m.episodes) {
    return JSON.stringify({
      episodes_aired: m.episodes,
      total_episodes: m.episodes,
      next_episode: null,
      next_air_time: null,
    })
  }
  return null
}

// GET /:category — list all items for a category
router.get('/:category', async (req, res) => {
  try {
    const items = await db.all(
      'SELECT * FROM ongoing_items WHERE category = ? ORDER BY created_at ASC',
      [req.params.category]
    )
    res.json(items.map(i => ({
      ...i,
      metadata: JSON.parse(i.metadata || '{}'),
      airing_info: i.airing_info ? JSON.parse(i.airing_info) : null,
      watched_progress: i.watched_progress ?? 0,
    })))
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// POST /sync/anilist — sync CURRENT anime+manga from AniList (includes airing info)
router.post('/sync/anilist', async (req, res) => {
  try {
    const userRow = await db.get('SELECT value FROM settings WHERE key = ?', ['anilist_username'])
    if (!userRow?.value) return res.status(400).json({ error: 'AniList username not configured' })

    let animeCount = 0, mangaCount = 0

    for (const [type, category] of [['ANIME', 'anime_ongoing'], ['MANGA', 'manga_ongoing']]) {
      const r = await fetch(ANILIST_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ query: ANILIST_QUERY, variables: { userName: userRow.value, type, status: 'CURRENT' } }),
      })
      if (!r.ok) throw new Error(`AniList API error: ${r.status}`)
      const json = await r.json()
      if (json.errors) throw new Error(json.errors[0].message)

      const entries = (json.data?.MediaListCollection?.lists || []).flatMap(l => l.entries)
      for (const e of entries) {
        const m = e.media
        const extId = String(m.id)
        const title = m.title.english || m.title.romaji
        const airingInfo = buildAiringInfo(m)

        const existing = await db.get(
          'SELECT id FROM ongoing_items WHERE category = ? AND external_id = ?',
          [category, extId]
        )
        if (existing) {
          // Update airing info for existing items
          await db.run('UPDATE ongoing_items SET airing_info = ? WHERE id = ?', [airingInfo, existing.id])
        } else {
          await db.run(
            'INSERT INTO ongoing_items (category, title, external_id, thumbnail_url, metadata, airing_info, source) VALUES (?, ?, ?, ?, ?, ?, ?)',
            [category, title, extId, m.coverImage?.medium || null, JSON.stringify({ format: m.format }), airingInfo, 'anilist']
          )
          type === 'ANIME' ? animeCount++ : mangaCount++
        }
      }
    }

    res.json({ anime: animeCount, manga: mangaCount })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// POST /sync/simkl — sync watching shows from Simkl
router.post('/sync/simkl', async (req, res) => {
  try {
    const [cidRow, tokenRow, lastActRow] = await Promise.all([
      db.get('SELECT value FROM settings WHERE key = ?', ['simkl_client_id']),
      db.get('SELECT value FROM settings WHERE key = ?', ['simkl_access_token']),
      db.get('SELECT value FROM settings WHERE key = ?', ['simkl_ongoing_last_activities']),
    ])
    if (!cidRow?.value || !tokenRow?.value) return res.status(400).json({ error: 'Simkl not configured' })

    const cid = cidRow.value
    const headers = simklHeaders(tokenRow.value, cid)
    const savedAll = lastActRow?.value ? JSON.parse(lastActRow.value).all : null

    // Phase 1: check activities — skip the heavy fetch if nothing has changed
    const actRes = await fetch(`https://api.simkl.com/sync/activities?${simklQS(cid)}`, { headers })
    if (!actRes.ok) throw new Error(`Simkl activities error: ${actRes.status}`)
    const activities = await actRes.json()
    const currentAll = activities.all

    if (savedAll && savedAll === currentAll) {
      return res.json({ series: 0, skipped: true })
    }

    // Phase 2: fetch watching shows; use date_from on subsequent syncs for delta only
    const qs = simklQS(cid, savedAll ? { date_from: savedAll } : {})
    const r = await fetch(`https://api.simkl.com/sync/all-items/watching/shows?${qs}`, { headers })
    if (r.status === 404) return res.json({ series: 0 })
    if (!r.ok) throw new Error(`Simkl API error: ${r.status}`)
    const data = await r.json()

    let count = 0
    for (const entry of (data.shows || [])) {
      const show = entry.show
      if (!show) continue
      const extId = show.ids?.simkl ? String(show.ids.simkl) : null
      const thumb = show.poster ? `https://simkl.in/posters/${show.poster}_m.webp` : null

      // Fetch per-show details — all-items doesn't include airing status or episode counts
      let showStatus = null
      let airingInfo = null
      if (extId) {
        try {
          const detailRes = await fetch(
            `https://api.simkl.com/tv/${extId}?${simklQS(cid, { extended: 'full' })}`,
            { headers }
          )
          if (detailRes.ok) {
            const detail = await detailRes.json()
            showStatus = (detail.status || '').toLowerCase()
            // aired_episodes is the count currently out; total_episodes is the planned run length
            const aired = typeof detail.aired_episodes === 'number' ? detail.aired_episodes : null
            const total = typeof detail.total_episodes === 'number' ? detail.total_episodes : null
            if (aired !== null) {
              airingInfo = JSON.stringify({
                episodes_aired: aired,
                total_episodes: total,
                next_episode: null,
                next_air_time: null,
              })
            }
          }
        } catch { /* keep defaults — include show by default */ }
        await new Promise(resolve => setTimeout(resolve, 300))
      }

      if (showStatus === 'ended' || showStatus === 'canceled' || showStatus === 'cancelled') continue

      const meta = JSON.stringify({ year: show.year, status: showStatus || null })
      if (extId) {
        const existing = await db.get(
          'SELECT id FROM ongoing_items WHERE category = ? AND external_id = ?',
          ['series_ongoing', extId]
        )
        if (existing) {
          // Update both status metadata and episode count so the "behind" indicator stays fresh
          await db.run(
            'UPDATE ongoing_items SET metadata = ?, airing_info = ? WHERE id = ?',
            [meta, airingInfo, existing.id]
          )
          continue
        }
      }
      await db.run(
        'INSERT INTO ongoing_items (category, title, external_id, thumbnail_url, metadata, airing_info, source) VALUES (?, ?, ?, ?, ?, ?, ?)',
        ['series_ongoing', show.title, extId, thumb, meta, airingInfo, 'simkl']
      )
      count++
    }

    // Persist the current activities timestamp for future delta syncs
    await db.run(
      'INSERT OR REPLACE INTO settings (key, value) VALUES (?, ?)',
      ['simkl_ongoing_last_activities', JSON.stringify({ all: currentAll })]
    )

    res.json({ series: count })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// POST /:category — add item manually
router.post('/:category', async (req, res) => {
  const { title, thumbnail_url } = req.body
  if (!title?.trim()) return res.status(400).json({ error: 'Title is required' })
  try {
    const r = await db.run(
      'INSERT INTO ongoing_items (category, title, thumbnail_url, metadata, source) VALUES (?, ?, ?, ?, ?)',
      [req.params.category, title.trim(), thumbnail_url || null, '{}', 'manual']
    )
    res.json({ id: r.lastInsertRowid })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// DELETE /item/:id — remove one item
router.delete('/item/:id', async (req, res) => {
  try {
    await db.run('DELETE FROM ongoing_items WHERE id = ?', [Number(req.params.id)])
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

// PATCH /item/:id — update watched progress or airing info
router.patch('/item/:id', async (req, res) => {
  try {
    const { airing_info, watched_progress } = req.body
    const sets = [], vals = []
    if (airing_info !== undefined) {
      sets.push('airing_info = ?')
      vals.push(airing_info ? JSON.stringify(airing_info) : null)
    }
    if (watched_progress !== undefined) {
      sets.push('watched_progress = ?')
      vals.push(Math.max(0, Number(watched_progress) || 0))
    }
    if (sets.length) {
      await db.run(`UPDATE ongoing_items SET ${sets.join(', ')} WHERE id = ?`, [...vals, Number(req.params.id)])
    }
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

module.exports = router
