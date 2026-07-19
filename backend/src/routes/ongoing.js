const express = require('express')
const router = express.Router()
const { db } = require('../database')
const { simklQS, simklHeaders } = require('../services/simkl')

const ANILIST_API = 'https://graphql.anilist.co'
const ANILIST_QUERY = `
query ($userName: String, $type: MediaType, $status: MediaListStatus) {
  MediaListCollection(userName: $userName, type: $type, status: $status) {
    lists { entries { media {
      id title { romaji english } coverImage { extraLarge large } format
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

const VALID_ONGOING = new Set(['series_ongoing', 'anime_ongoing', 'manga_ongoing', 'comics_ongoing', 'games_continuous'])

router.get('/:category', async (req, res) => {
  if (!VALID_ONGOING.has(req.params.category)) return res.status(400).json({ error: 'Invalid category' })
  try {
    const items = await db.all(
      'SELECT * FROM ongoing_items WHERE user_id = ? AND category = ? ORDER BY created_at ASC',
      [req.userId, req.params.category]
    )
    res.json(items.map(i => ({
      ...i,
      metadata: JSON.parse(i.metadata || '{}'),
      airing_info: i.airing_info ? JSON.parse(i.airing_info) : null,
      watched_progress: i.watched_progress ?? 0,
    })))
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.post('/sync/anilist', async (req, res) => {
  try {
    const userRow = await db.get(
      'SELECT value FROM settings WHERE user_id = ? AND key = ?',
      [req.userId, 'anilist_username']
    )
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
          'SELECT id FROM ongoing_items WHERE user_id = ? AND category = ? AND external_id = ?',
          [req.userId, category, extId]
        )
        if (existing) {
          await db.run('UPDATE ongoing_items SET airing_info = ? WHERE id = ?', [airingInfo, existing.id])
        } else {
          await db.run(
            'INSERT INTO ongoing_items (user_id, category, title, external_id, thumbnail_url, metadata, airing_info, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
            [req.userId, category, title, extId, m.coverImage?.extraLarge || m.coverImage?.large || null, JSON.stringify({ format: m.format }), airingInfo, 'anilist']
          )
          type === 'ANIME' ? animeCount++ : mangaCount++
        }
      }
    }

    res.json({ anime: animeCount, manga: mangaCount })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.post('/sync/simkl', async (req, res) => {
  try {
    const [cidRow, tokenRow] = await Promise.all([
      db.get('SELECT value FROM settings WHERE user_id = ? AND key = ?', [req.userId, 'simkl_client_id']),
      db.get('SELECT value FROM settings WHERE user_id = ? AND key = ?', [req.userId, 'simkl_access_token']),
    ])
    if (!cidRow?.value || !tokenRow?.value) return res.status(400).json({ error: 'Simkl not configured' })

    const cid = cidRow.value
    const headers = simklHeaders(tokenRow.value, cid)

    const r = await fetch(`https://api.simkl.com/sync/all-items/watching/shows?${simklQS(cid)}`, { headers })
    if (r.status === 404) return res.json({ series: 0 })
    if (!r.ok) throw new Error(`Simkl API error: ${r.status}`)
    const data = await r.json()

    let count = 0
    for (const entry of (data.shows || [])) {
      const show = entry.show
      if (!show) continue
      const extId = show.ids?.simkl ? String(show.ids.simkl) : null
      const thumb = show.poster ? `https://simkl.in/posters/${show.poster}_m.webp` : null

      const totalFromEntry = show.episode_count != null ? Number(show.episode_count)
        : show.total_episodes != null ? Number(show.total_episodes) : null
      const watchedFromSimkl = entry.watched_episodes_count != null ? Number(entry.watched_episodes_count) : null

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
            const aired = detail.aired_episodes != null ? Number(detail.aired_episodes)
              : detail.total_aired_episodes != null ? Number(detail.total_aired_episodes) : null
            const total = detail.total_episodes != null ? Number(detail.total_episodes)
              : detail.episode_count != null ? Number(detail.episode_count) : totalFromEntry
            if (aired !== null && !isNaN(aired)) {
              airingInfo = JSON.stringify({ episodes_aired: aired, total_episodes: total !== null && !isNaN(total) ? total : null, next_episode: null, next_air_time: null })
            } else if (total !== null && !isNaN(total)) {
              airingInfo = JSON.stringify({ episodes_aired: total, total_episodes: total, next_episode: null, next_air_time: null })
            }
          }
        } catch (e) {
          console.warn(`[simkl-ongoing] detail fetch failed for ${extId}: ${e.message}`)
        }
        if (!airingInfo && totalFromEntry !== null && !isNaN(totalFromEntry)) {
          airingInfo = JSON.stringify({ episodes_aired: totalFromEntry, total_episodes: totalFromEntry, next_episode: null, next_air_time: null })
        }
        await new Promise(resolve => setTimeout(resolve, 300))
      }

      if (showStatus === 'ended' || showStatus === 'canceled' || showStatus === 'cancelled') continue

      const meta = JSON.stringify({ year: show.year, status: showStatus || null })
      if (extId) {
        const existing = await db.get(
          'SELECT id FROM ongoing_items WHERE user_id = ? AND category = ? AND external_id = ?',
          [req.userId, 'series_ongoing', extId]
        )
        if (existing) {
          if (airingInfo !== null) {
            await db.run('UPDATE ongoing_items SET metadata = ?, airing_info = ? WHERE id = ?', [meta, airingInfo, existing.id])
          } else {
            await db.run('UPDATE ongoing_items SET metadata = ? WHERE id = ?', [meta, existing.id])
          }
          continue
        }
      }
      await db.run(
        'INSERT INTO ongoing_items (user_id, category, title, external_id, thumbnail_url, metadata, airing_info, watched_progress, source) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)',
        [req.userId, 'series_ongoing', show.title, extId, thumb, meta, airingInfo, watchedFromSimkl ?? 0, 'simkl']
      )
      count++
    }

    res.json({ series: count })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.post('/:category', async (req, res) => {
  if (!VALID_ONGOING.has(req.params.category)) return res.status(400).json({ error: 'Invalid category' })
  const { title, thumbnail_url } = req.body
  if (!title?.trim()) return res.status(400).json({ error: 'Title is required' })
  try {
    const r = await db.run(
      'INSERT INTO ongoing_items (user_id, category, title, thumbnail_url, metadata, source) VALUES (?, ?, ?, ?, ?, ?)',
      [req.userId, req.params.category, title.trim(), thumbnail_url || null, '{}', 'manual']
    )
    res.json({ id: r.lastInsertRowid })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

router.delete('/item/:id', async (req, res) => {
  try {
    await db.run(
      'DELETE FROM ongoing_items WHERE id = ? AND user_id = ?',
      [Number(req.params.id), req.userId]
    )
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

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
      await db.run(
        `UPDATE ongoing_items SET ${sets.join(', ')} WHERE id = ? AND user_id = ?`,
        [...vals, Number(req.params.id), req.userId]
      )
    }
    res.json({ ok: true })
  } catch (e) { res.status(500).json({ error: e.message }) }
})

module.exports = router
