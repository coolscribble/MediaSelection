import { useState, useEffect, useRef } from 'react'
import { OngoingCategoryDef, OngoingItem, ONGOING_CATEGORIES, AiringInfo } from '../types'
import { getOngoingItems, addOngoingItem, deleteOngoingItem, syncOngoingAniList, syncOngoingSimkl } from '../api'

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
  const inputRef = useRef<HTMLInputElement>(null)

  const load = () =>
    getOngoingItems(category.id).then(data => setItems(data as OngoingItem[])).catch(() => {})

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

  const handleSync = async () => {
    setSyncing(true)
    setMsg('')
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
      load()
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : 'Sync failed')
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
          const airingStr = item.airing_info ? formatAiring(item.airing_info) : ''
          return (
            <div key={item.id} className="ongoing-tile" title={item.title}>
              {item.thumbnail_url
                ? <img className="ongoing-tile-thumb" src={item.thumbnail_url} alt="" loading="lazy" />
                : <div className="ongoing-tile-thumb-placeholder">{category.icon}</div>
              }
              <div className="ongoing-tile-info">
                <span className="ongoing-tile-title">{item.title}</span>
                {airingStr && <span className="ongoing-tile-airing">{airingStr}</span>}
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
