import { useState, useEffect, useRef } from 'react'
import { OngoingCategoryDef, OngoingItem, ONGOING_CATEGORIES, AiringInfo } from '../types'
import { getOngoingItems, addOngoingItem, deleteOngoingItem, syncOngoingAniList, syncOngoingSimkl, updateOngoingProgress } from '../api'
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

// An item is still releasing if:
//   - metadata.status is explicitly "ended"/"canceled" → hide it
//   - no airing_info and status is unknown → assume active (manually added)
//   - total_episodes is unknown (ongoing) → show
//   - next episode is still upcoming → show
//   - episodes_aired < total_episodes → show
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
  const [newTitle, setNewTitle] = useState('')
  const [syncing, setSyncing] = useState(false)
  const [msg, setMsg] = useState('')
  const [watchedMap, setWatchedMap] = useState<Record<number, number>>({})
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
  useEffect(() => { if (adding) inputRef.current?.focus() }, [adding])

  const handleAdd = async () => {
    if (!newTitle.trim()) return
    await addOngoingItem(category.id, newTitle.trim())
    setNewTitle('')
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

  // Only show items that are still actively releasing
  const visibleItems = items.filter(isStillReleasing)

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
          + Add
        </button>
        {msg && (
          <span style={{ fontSize: 11, color: msg.startsWith('+') ? 'var(--success)' : 'var(--danger)' }}>
            {msg}
          </span>
        )}
      </div>

      {adding && (
        <div className="ongoing-add-form">
          <input
            ref={inputRef}
            placeholder="Title…"
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            onKeyDown={e => {
              if (e.key === 'Enter') handleAdd()
              if (e.key === 'Escape') { setAdding(false); setNewTitle('') }
            }}
          />
          <button className="btn-primary" onClick={handleAdd} style={{ fontSize: 12, padding: '4px 12px' }}>Add</button>
          <button className="btn-ghost" onClick={() => { setAdding(false); setNewTitle('') }} style={{ fontSize: 12 }}>✕</button>
        </div>
      )}

      {/* Tile grid — one card per releasing show/anime/comic/game */}
      <div className="ongoing-tiles">
        {visibleItems.length === 0 && !adding && (
          <span className="ongoing-empty">Nothing currently releasing — add manually or sync</span>
        )}
        {visibleItems.map(item => {
          const ai = item.airing_info
          const airingStr = ai ? formatAiring(ai) : ''
          const airedCount = ai ? (ai.total_episodes ?? ai.episodes_aired ?? null) : null
          const watched = watchedMap[item.id] ?? 0
          const showProgress = category.id === 'anime_ongoing' || category.id === 'series_ongoing' || category.id === 'manga_ongoing'
          const unit = category.id === 'manga_ongoing' ? 'ch' : 'ep'
          return (
            <div key={item.id} className="ongoing-tile" title={item.title}>
              {item.thumbnail_url
                ? <img className="ongoing-tile-thumb" src={item.thumbnail_url} alt="" loading="lazy" />
                : <div className="ongoing-tile-thumb-placeholder">{category.icon}</div>
              }
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
                      max={airedCount ?? undefined}
                      value={watched}
                      onChange={e => handleWatched(item.id, parseInt(e.target.value))}
                    />
                    {airedCount !== null && <span>/{airedCount}</span>}
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
