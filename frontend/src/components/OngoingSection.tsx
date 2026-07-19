import { useState, useEffect, useRef } from 'react'
import { OngoingCategoryDef, OngoingItem, LibraryItem, ONGOING_CATEGORIES, AiringInfo } from '../types'
import { getOngoingItems, addOngoingItem, deleteOngoingItem, syncOngoingAniList, syncOngoingSimkl, updateOngoingProgress, getLibrary } from '../api'
import { toast, dismiss } from '../notifications'

function formatAiring(ai: AiringInfo): string {
  const epPart = ai.total_episodes
    ? `${ai.episodes_aired}/${ai.total_episodes} ep`
    : ai.episodes_aired > 0
      ? `${ai.episodes_aired} ep out`
      : ''

  let nextPart = ''
  if (ai.next_air_time && ai.next_episode) {
    const diff = ai.next_air_time - Date.now()
    if (diff > 0) {
      const days = Math.floor(diff / 86400000)
      const hours = Math.floor((diff % 86400000) / 3600000)
      const timeStr = days > 0 ? `${days}d ${hours}h` : `${hours}h`
      nextPart = `Ep${ai.next_episode} in ${timeStr}`
    }
  }

  return [epPart, nextPart].filter(Boolean).join(' · ')
}

function isStillReleasing(item: OngoingItem): boolean {
  const status = ((item.metadata?.status as string) || '').toLowerCase()
  if (status === 'ended' || status === 'canceled' || status === 'cancelled') return false
  const ai = item.airing_info
  if (!ai) return true
  if (ai.total_episodes === null) return true
  if (ai.next_air_time && ai.next_air_time > Date.now()) return true
  if (ai.episodes_aired < (ai.total_episodes ?? Infinity)) return true
  return false
}

export default function OngoingSection() {
  return (
    <div className="ongoing-section">
      <div className="section-divider">
        <span>Currently Releasing</span>
      </div>
      <div className="ongoing-rows">
        {ONGOING_CATEGORIES.map(cat => (
          <OngoingRow key={cat.id} category={cat} />
        ))}
      </div>
    </div>
  )
}

function OngoingRow({ category }: { category: OngoingCategoryDef }) {
  const [items, setItems] = useState<OngoingItem[]>([])
  const [adding, setAdding] = useState(false)
  const [search, setSearch] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [msg, setMsg] = useState('')
  const [watchedMap, setWatchedMap] = useState<Record<number, number>>({})
  const [libItems, setLibItems] = useState<LibraryItem[]>([])
  const [libLoading, setLibLoading] = useState(false)
  const watchedTimers = useRef<Record<number, ReturnType<typeof setTimeout>>>({})
  const inputRef = useRef<HTMLInputElement>(null)

  const load = () =>
    getOngoingItems(category.id).then(data => {
      const list = data as OngoingItem[]
      setItems(list)
      const map: Record<number, number> = {}
      list.forEach(item => { map[item.id] = item.watched_progress ?? 0 })
      setWatchedMap(map)
    }).catch(() => {})

  useEffect(() => { load() }, [category.id])

  useEffect(() => {
    if (adding) {
      inputRef.current?.focus()
      setLibLoading(true)
      getLibrary(category.libraryCategory)
        .then(data => setLibItems(data as LibraryItem[]))
        .catch(() => {})
        .finally(() => setLibLoading(false))
    } else {
      setSearch('')
      setLibItems([])
    }
  }, [adding, category.libraryCategory])

  const handleAddItem = async (title: string, thumbnail_url?: string | null) => {
    if (!title.trim()) return
    await addOngoingItem(category.id, title.trim(), thumbnail_url)
    setSearch('')
    setAdding(false)
    load()
  }

  const handleDelete = async (id: number) => {
    await deleteOngoingItem(id)
    load()
  }

  const handleWatched = (id: number, val: number) => {
    const v = Math.max(0, isNaN(val) ? 0 : val)
    setWatchedMap(prev => ({ ...prev, [id]: v }))
    if (watchedTimers.current[id]) clearTimeout(watchedTimers.current[id])
    watchedTimers.current[id] = setTimeout(() => {
      updateOngoingProgress(id, v).catch(() => {})
    }, 600)
  }

  const handleSync = async () => {
    setSyncing(true)
    setMsg('')
    const src = category.syncSource === 'anilist' ? 'AniList' : 'Simkl'
    const tid = toast(`Syncing ${category.label} from ${src}…`, 'info', true)
    try {
      let count = 0
      if (category.syncSource === 'anilist') {
        const r = await syncOngoingAniList() as Record<string, number>
        count = r[category.resultKey ?? ''] ?? 0
      } else if (category.syncSource === 'simkl') {
        const r = await syncOngoingSimkl() as Record<string, number>
        count = r[category.resultKey ?? ''] ?? 0
      }
      setMsg(`+${count} added`)
      dismiss(tid)
      toast(`${category.label}: +${count} added from ${src}`, 'success')
      load()
    } catch (e: unknown) {
      const err = e instanceof Error ? e.message : 'Sync failed'
      setMsg(err)
      dismiss(tid)
      toast(`${category.label} sync failed: ${err}`, 'error')
    } finally {
      setSyncing(false)
    }
  }

  const visibleItems = items.filter(isStillReleasing)

  // Filter library items: search on title + romaji_title metadata
  const q = search.toLowerCase()
  const filteredLib = libItems.filter(i => {
    if (!q) return true
    if (i.title.toLowerCase().includes(q)) return true
    const romaji = typeof (i.metadata as Record<string, unknown>).romaji_title === 'string'
      ? ((i.metadata as Record<string, string>).romaji_title).toLowerCase()
      : ''
    return romaji.includes(q)
  })

  // IDs already in the ongoing list — hide them from the picker
  const existingExtIds = new Set(items.map(i => i.external_id).filter(Boolean))
  const existingTitles = new Set(items.map(i => i.title.toLowerCase()))
  const pickableLib = filteredLib.filter(i =>
    !existingExtIds.has(i.external_id) && !existingTitles.has(i.title.toLowerCase())
  )

  return (
    <div className="ongoing-row">
      <div className="ongoing-row-head">
        <span className="ongoing-row-title">{category.icon} {category.label}</span>
        {category.syncSource && (
          <button
            className="btn-ghost"
            onClick={handleSync}
            disabled={syncing}
            style={{ fontSize: 12, padding: '3px 10px' }}
            title={`Sync from ${category.syncSource === 'anilist' ? 'AniList' : 'Simkl'}`}
          >
            {syncing ? '…' : '⟳ Sync'}
          </button>
        )}
        <button
          className="btn-secondary"
          onClick={() => setAdding(v => !v)}
          style={{ fontSize: 12, padding: '3px 10px' }}
        >
          {adding ? '✕ Close' : '+ Add'}
        </button>
        {msg && (
          <span style={{ fontSize: 11, color: msg.startsWith('+') ? 'var(--success)' : 'var(--danger)' }}>
            {msg}
          </span>
        )}
      </div>

      {adding && (
        <div className="ongoing-add-picker">
          <input
            ref={inputRef}
            className="ongoing-add-search"
            placeholder={`Search ${category.label} library…`}
            value={search}
            onChange={e => setSearch(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Escape') { setAdding(false); setSearch('') }
            }}
          />
          <div className="ongoing-add-list">
            {libLoading && <div className="ongoing-add-empty">Loading…</div>}
            {!libLoading && pickableLib.length === 0 && !search && (
              <div className="ongoing-add-empty">No {category.label} in library — import via CSV first</div>
            )}
            {!libLoading && pickableLib.map(item => (
              <div
                key={item.id}
                className="ongoing-add-item"
                onClick={() => handleAddItem(item.title, item.thumbnail_url)}
              >
                {item.thumbnail_url
                  ? <img src={item.thumbnail_url} alt="" />
                  : <span className="ongoing-add-item-icon">{category.icon}</span>
                }
                <span className="ongoing-add-item-title">{item.title}</span>
              </div>
            ))}
            {!libLoading && search && (
              <div
                className="ongoing-add-item ongoing-add-manual"
                onClick={() => handleAddItem(search)}
              >
                <span className="ongoing-add-item-icon">✏️</span>
                <span className="ongoing-add-item-title">Add "{search}" manually</span>
              </div>
            )}
          </div>
        </div>
      )}

      <div className="ongoing-tiles">
        {visibleItems.length === 0 && !adding && (
          <span className="ongoing-empty">Nothing currently releasing — add manually or sync</span>
        )}
        {visibleItems.map(item => {
          const ai = item.airing_info
          const airingStr = ai ? formatAiring(ai) : ''
          const episodesAired = ai?.episodes_aired ?? null
          const watched = watchedMap[item.id] ?? 0
          const showProgress = category.id === 'anime_ongoing' || category.id === 'series_ongoing' || category.id === 'manga_ongoing'
          const unit = category.id === 'manga_ongoing' ? 'ch' : 'ep'
          const behind = showProgress && episodesAired !== null && episodesAired > watched
            ? episodesAired - watched
            : 0
          return (
            <div key={item.id} className={`ongoing-tile${behind > 0 ? ' ongoing-tile--behind' : ''}`} title={item.title}>
              {item.thumbnail_url
                ? <img className="ongoing-tile-thumb" src={item.thumbnail_url} alt="" loading="lazy" />
                : <div className="ongoing-tile-thumb-placeholder">{category.icon}</div>
              }
              {behind > 0 && (
                <div className="behind-badge" title={`${behind} ${unit} to catch up`}>+{behind}</div>
              )}
              <div className="ongoing-tile-info">
                <span className="ongoing-tile-title">{item.title}</span>
                {airingStr && <span className="ongoing-tile-airing">{airingStr}</span>}
                {showProgress && (
                  <div className="ongoing-tile-watched" onClick={e => e.stopPropagation()}>
                    <span>👁</span>
                    <input
                      type="number"
                      className="ongoing-watched-input"
                      min={0}
                      max={episodesAired ?? undefined}
                      value={watched}
                      onChange={e => handleWatched(item.id, parseInt(e.target.value))}
                    />
                    {episodesAired !== null && (
                      <span style={behind > 0 ? { color: 'var(--warning)', fontWeight: 600 } : undefined}>
                        /{episodesAired}
                      </span>
                    )}
                    <span>{unit}</span>
                  </div>
                )}
              </div>
              <button
                className="ongoing-tile-remove"
                onClick={() => handleDelete(item.id)}
                title="Remove"
              >✕</button>
            </div>
          )
        })}
      </div>
    </div>
  )
}
