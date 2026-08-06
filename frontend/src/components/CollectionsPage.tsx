import { useState, useEffect, useCallback } from 'react'
import { getCollections, createCollection, deleteCollection, addCollectionItem, removeCollectionItem, autoDetectCollections, autoDetectAnimeCollections, getLibrary, getCollectionMissing } from '../api'
import { toast } from '../notifications'

const CATEGORIES = ['movies', 'series', 'anime', 'manga', 'games', 'comics', 'albums']
const CATEGORY_LABELS: Record<string, string> = {
  movies: 'Movies', series: 'TV Shows', anime: 'Anime', manga: 'Manga',
  games: 'Games', comics: 'Comics', albums: 'Albums',
}
const CATEGORY_ICONS: Record<string, string> = {
  movies: '🎬', series: '📺', anime: '⛩️', manga: '📚',
  games: '🎮', comics: '💬', albums: '🎵',
}
const COLLECTION_BONUS_PER_ENTRY: Record<string, number> = {
  movies: 10, series: 20, anime: 20, manga: 10, games: 15, comics: 10, albums: 10,
}

interface CollectionItem {
  id: number
  library_item_id: number | null
  title: string
  thumbnail_url: string | null
  completed_at: string | null
  sort_order: number
}

interface Collection {
  id: number
  name: string
  category: string
  cover_url: string | null
  external_id: string | null
  franchise_total: number | null
  items: CollectionItem[]
}

interface MissingMovie {
  tmdb_id: number
  title: string
  release_date: string | null
  poster_url: string | null
  in_library: boolean
  finished: boolean
}

interface Props {
  onBack: () => void
  onRefresh: () => void
  hiddenCategories?: string[]
}

export default function CollectionsPage({ onBack, onRefresh, hiddenCategories = [] }: Props) {
  const [collections, setCollections] = useState<Collection[]>([])
  const [loading, setLoading] = useState(true)
  const [catFilter, setCatFilter] = useState('all')
  const [selected, setSelected] = useState<Collection | null>(null)
  const [creating, setCreating] = useState(false)
  const [newName, setNewName] = useState('')
  const [newCat, setNewCat] = useState('anime')
  const [busy, setBusy] = useState(false)
  const [addingItem, setAddingItem] = useState(false)
  const [libraryItems, setLibraryItems] = useState<{ id: number; title: string; thumbnail_url: string | null }[]>([])
  const [itemSearch, setItemSearch] = useState('')
  const [detecting, setDetecting] = useState(false)
  const [detectingAnime, setDetectingAnime] = useState(false)
  const [missing, setMissing] = useState<MissingMovie[]>([])
  const [missingLoading, setMissingLoading] = useState(false)
  const [syncProgress, setSyncProgress] = useState<{ step: string; pct: number } | null>(null)

  const load = useCallback(async () => {
    setLoading(true)
    try {
      const data = await getCollections() as Collection[]
      setCollections(data)
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Failed to load collections', 'error')
    } finally { setLoading(false) }
  }, [])

  useEffect(() => { load() }, [load])

  const handleCreate = async () => {
    if (!newName.trim()) return
    setBusy(true)
    try {
      const col = await createCollection(newName.trim(), newCat) as Collection
      col.items = []
      setCollections(prev => [col, ...prev])
      setCreating(false); setNewName('')
      toast(`Collection "${col.name}" created`, 'success')
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Create failed', 'error')
    } finally { setBusy(false) }
  }

  const handleDelete = async (col: Collection) => {
    if (!confirm(`Delete collection "${col.name}"?`)) return
    setBusy(true)
    try {
      await deleteCollection(col.id)
      setCollections(prev => prev.filter(c => c.id !== col.id))
      if (selected?.id === col.id) setSelected(null)
      onRefresh()
      toast('Collection deleted', 'success')
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Delete failed', 'error')
    } finally { setBusy(false) }
  }

  const handleOpenAddItem = async (col: Collection) => {
    setAddingItem(true)
    setItemSearch('')
    try {
      const items = await getLibrary(col.category) as { id: number; title: string; thumbnail_url: string | null }[]
      const existingIds = new Set(col.items.map(ci => ci.library_item_id).filter(Boolean))
      setLibraryItems(items.filter(i => !existingIds.has(i.id)))
    } catch { setLibraryItems([]) }
  }

  const handleAddItem = async (col: Collection, libItem: { id: number; title: string; thumbnail_url: string | null }) => {
    setBusy(true)
    try {
      const ci = await addCollectionItem(col.id, libItem.id) as CollectionItem
      const updated = { ...col, items: [...col.items, { ...ci, completed_at: null }] }
      setCollections(prev => prev.map(c => c.id === col.id ? updated : c))
      setSelected(updated)
      setAddingItem(false)
      onRefresh()
      toast(`"${libItem.title}" added`, 'success')
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Add failed', 'error')
    } finally { setBusy(false) }
  }

  const handleRemoveItem = async (col: Collection, item: CollectionItem) => {
    setBusy(true)
    try {
      await removeCollectionItem(col.id, item.id)
      const updated = { ...col, items: col.items.filter(ci => ci.id !== item.id) }
      setCollections(prev => prev.map(c => c.id === col.id ? updated : c))
      setSelected(updated)
      onRefresh()
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Remove failed', 'error')
    } finally { setBusy(false) }
  }

  const handleAutoDetect = async () => {
    setDetecting(true)
    try {
      const r = await autoDetectCollections() as { created: number; checked: number; groups: number }
      await load()
      onRefresh()
      toast(`Auto-detect: ${r.created} new collection(s) from ${r.checked} movies`, 'success')
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Auto-detect failed', 'error')
    } finally { setDetecting(false) }
  }

  const handleAutoDetectAnime = async () => {
    setDetectingAnime(true)
    try {
      const r = await autoDetectAnimeCollections() as { created: number; checked: number; components: number }
      await load()
      onRefresh()
      toast(`Anime auto-detect: ${r.created} new collection(s) from ${r.checked} anime (${r.components} franchise groups found)`, 'success')
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Anime auto-detect failed', 'error')
    } finally { setDetectingAnime(false) }
  }

  const handleSyncWatched = () => {
    if (syncProgress) return
    setSyncProgress({ step: 'Connecting…', pct: 0 })
    const es = new EventSource('/api/collections/sync-watched', { withCredentials: true })
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as { step?: string; pct?: number; done?: boolean; error?: string; result?: { updated: number } }
        setSyncProgress({ step: data.step || data.error || 'Working…', pct: data.pct ?? 50 })
        if (data.done) {
          es.close()
          setTimeout(() => {
            setSyncProgress(null)
            load()
            if (data.error) toast(data.error, 'error')
            else toast(data.result ? `Sync done: ${data.result.updated} entr${data.result.updated === 1 ? 'y' : 'ies'} marked as watched` : 'Sync complete', 'success')
          }, 1200)
        }
      } catch { /* ignore parse errors */ }
    }
    es.onerror = () => {
      es.close()
      setSyncProgress(null)
      toast('Sync failed — check your Simkl/AniList settings', 'error')
    }
  }

  const displayed =
    catFilter === 'finished'     ? collections.filter(c => completionOf(c).complete)
    : catFilter === 'not-finished' ? collections.filter(c => !completionOf(c).complete)
    : catFilter === 'all'          ? collections
    :                                collections.filter(c => c.category === catFilter)

  function completionOf(col: Collection) {
    const inCol   = col.items.length
    const done    = col.items.filter(i => i.completed_at).length
    const denom   = col.franchise_total ?? inCol   // use full franchise count when known
    return { inCol, done, denom, complete: denom >= 2 && done >= denom, pct: denom > 0 ? done / denom : 0 }
  }

  function bonusXp(col: Collection) {
    return col.items.length * (COLLECTION_BONUS_PER_ENTRY[col.category] || 10)
  }

  const openCollection = (col: Collection) => {
    setSelected(col)
    setMissing([])
    setAddingItem(false)
    if (col.category === 'movies' && col.external_id) {
      setMissingLoading(true)
      getCollectionMissing(col.id)
        .then((d: unknown) => {
          const resp = d as { missing: MissingMovie[]; franchise_total?: number }
          setMissing(resp.missing || [])
          // Patch franchise_total onto both selected and collection list
          if (resp.franchise_total != null) {
            const patch = (c: Collection) =>
              c.id === col.id ? { ...c, franchise_total: resp.franchise_total! } : c
            setCollections(prev => prev.map(patch))
            setSelected(prev => prev ? patch(prev) : prev)
          }
        })
        .catch(() => setMissing([]))
        .finally(() => setMissingLoading(false))
    }
  }

  const filteredLibrary = libraryItems.filter(i => i.title.toLowerCase().includes(itemSearch.toLowerCase()))

  return (
    <div style={{ minHeight: '100vh', background: 'var(--bg)' }}>
      {/* Header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 20px', background: 'var(--surface)', borderBottom: '1px solid var(--border)', flexWrap: 'wrap', position: 'sticky', top: 30, zIndex: 10 }}>
        <button className="btn-ghost" onClick={onBack}>← Back</button>
        <h2 style={{ margin: 0, fontSize: 18, fontWeight: 700 }}>🗂 Collections</h2>
        <div style={{ flex: 1 }} />
        <button className="btn-ghost" onClick={handleSyncWatched} disabled={!!syncProgress} title="Mark collection items as watched based on your Simkl & AniList history">
          {syncProgress ? '⏳ Syncing…' : '🔄 Sync Watched'}
        </button>
        <button className="btn-ghost" onClick={handleAutoDetectAnime} disabled={detectingAnime} title="Group anime seasons/sequels via AniList relations">
          {detectingAnime ? '…' : '⛩ Auto-detect Anime'}
        </button>
        <button className="btn-ghost" onClick={handleAutoDetect} disabled={detecting} title="Detect movie franchises via TMDB">
          {detecting ? '…' : '🎬 Auto-detect Movies'}
        </button>
        <button className="btn-primary" onClick={() => setCreating(true)}>+ New Collection</button>
      </div>

      {/* Sync progress bar */}
      {syncProgress && (
        <div style={{ padding: '8px 20px', background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, fontSize: 12, color: 'var(--text2)' }}>
            <span>{syncProgress.step}</span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{syncProgress.pct}%</span>
          </div>
          <div style={{ height: 5, borderRadius: 3, background: 'var(--border)', overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: `${syncProgress.pct}%`,
              borderRadius: 3,
              background: syncProgress.pct === 100 ? '#27ae60' : 'var(--accent)',
              transition: 'width 0.6s ease, background 0.4s',
            }} />
          </div>
        </div>
      )}

      {/* Category tabs */}
      <div style={{ display: 'flex', gap: 4, padding: '12px 20px 0', overflowX: 'auto', background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
        {['all', 'finished', 'not-finished', ...CATEGORIES.filter(c => !hiddenCategories.includes(c))].map(cat => (
          <button key={cat} onClick={() => setCatFilter(cat)}
            style={{ padding: '6px 14px', borderRadius: 20, border: 'none', cursor: 'pointer', fontWeight: catFilter === cat ? 700 : 400, fontSize: 13, whiteSpace: 'nowrap',
              background: catFilter === cat
                ? (cat === 'finished' ? '#27ae60' : cat === 'not-finished' ? '#e67e22' : 'var(--accent)')
                : 'var(--bg)',
              color: catFilter === cat ? '#fff'
                : cat === 'finished' ? '#27ae60'
                : cat === 'not-finished' ? '#e67e22'
                : 'var(--text)' }}>
            {cat === 'all' ? 'All'
              : cat === 'finished' ? '✓ Finished'
              : cat === 'not-finished' ? '… In Progress'
              : `${CATEGORY_ICONS[cat]} ${CATEGORY_LABELS[cat]}`}
          </button>
        ))}
      </div>

      <div style={{ padding: 20 }}>
        {/* Create collection form */}
        {creating && (
          <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 8, padding: 16, marginBottom: 16, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <input autoFocus value={newName} onChange={e => setNewName(e.target.value)}
              placeholder="Collection name" className="input"
              style={{ flex: 1, minWidth: 180 }}
              onKeyDown={e => e.key === 'Enter' && handleCreate()}
            />
            <select value={newCat} onChange={e => setNewCat(e.target.value)}
              style={{ padding: '6px 10px', borderRadius: 6, border: '1px solid var(--border)', background: 'var(--bg)', color: 'var(--text)', fontSize: 13 }}>
              {CATEGORIES.map(c => <option key={c} value={c}>{CATEGORY_ICONS[c]} {CATEGORY_LABELS[c]}</option>)}
            </select>
            <button className="btn-primary" onClick={handleCreate} disabled={busy || !newName.trim()}>Create</button>
            <button className="btn-ghost" onClick={() => { setCreating(false); setNewName('') }}>Cancel</button>
          </div>
        )}

        {loading ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--text2)' }}>Loading…</div>
        ) : displayed.length === 0 ? (
          <div style={{ textAlign: 'center', padding: 40, color: 'var(--text2)' }}>
            {catFilter === 'finished'
              ? 'No finished collections yet. Complete all entries in a collection to see it here.'
              : catFilter === 'not-finished'
              ? 'All your collections are finished!'
              : `No collections yet.${catFilter === 'movies' ? ' Try "Auto-detect Movies" to find franchises.' : ' Click "+ New Collection" to create one.'}`
            }
          </div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 12 }}>
            {displayed.map(col => {
              const { inCol, done, denom, complete } = completionOf(col)
              const xp = bonusXp(col)
              const cover = col.cover_url || col.items.find(i => i.thumbnail_url)?.thumbnail_url
              return (
                <div key={col.id} className="collection-card" onClick={() => openCollection(col)}>
                  {cover
                    ? <img src={cover} alt={col.name} className="collection-card-cover" />
                    : <div className="collection-card-cover collection-card-icon">{CATEGORY_ICONS[col.category]}</div>
                  }
                  <div className="collection-card-body">
                    <div className="collection-card-title" title={col.name}>{col.name}</div>
                    <div className="collection-card-meta">{CATEGORY_ICONS[col.category]} {CATEGORY_LABELS[col.category]} · {inCol} {inCol === 1 ? 'entry' : 'entries'}</div>
                    {denom > 0 && (
                      <>
                        <div style={{ margin: '5px 0 3px', height: 5, borderRadius: 3, background: 'var(--border)', overflow: 'hidden' }}>
                          <div style={{
                            height: '100%',
                            width: `${Math.round((done / denom) * 100)}%`,
                            borderRadius: 3,
                            background: complete ? '#27ae60' : done > 0 ? '#e67e22' : '#555',
                            transition: 'width 0.4s',
                          }} />
                        </div>
                        <div className={`collection-card-progress ${complete ? 'complete' : done > 0 ? 'partial' : ''}`}>
                          {complete ? '✓ Complete' : `${done}/${denom} done`}
                          {complete ? ` · +${xp} XP` : ` · +${xp} XP on finish`}
                        </div>
                      </>
                    )}
                  </div>
                  <div className="collection-card-overlay">
                    <button className="btn-ghost" style={{ fontSize: 12, padding: '3px 8px' }}
                      onClick={e => { e.stopPropagation(); openCollection(col) }}>✏ Edit</button>
                    <button className="btn-ghost" style={{ fontSize: 12, padding: '3px 8px', color: '#e55' }}
                      onClick={e => { e.stopPropagation(); handleDelete(col) }}>✕</button>
                  </div>
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Collection detail panel */}
      {selected && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.55)', zIndex: 100, display: 'flex', alignItems: 'flex-end', justifyContent: 'center' }}
          onClick={e => { if (e.target === e.currentTarget) { setSelected(null); setAddingItem(false); setMissing([]) } }}>
          <div style={{ width: '100%', maxWidth: 700, background: 'var(--surface)', borderRadius: '12px 12px 0 0', padding: 20, maxHeight: '80vh', overflowY: 'auto' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 8 }}>
              <span style={{ fontSize: 20 }}>{CATEGORY_ICONS[selected.category]}</span>
              <h3 style={{ margin: 0, flex: 1, fontSize: 16 }}>{selected.name}</h3>
              <span style={{ fontSize: 12, color: 'var(--text2)' }}>
                {completionOf(selected).done}/{completionOf(selected).denom} done · +{bonusXp(selected)} XP bonus
              </span>
              <button className="btn-ghost" style={{ fontSize: 18, padding: '0 6px' }} onClick={() => { setSelected(null); setAddingItem(false); setMissing([]) }}>×</button>
            </div>
            {completionOf(selected).denom > 0 && (() => {
              const { done, denom, complete } = completionOf(selected)
              return (
                <div style={{ marginBottom: 16, height: 6, borderRadius: 3, background: 'var(--border)', overflow: 'hidden' }}>
                  <div style={{
                    height: '100%',
                    width: `${Math.round((done / denom) * 100)}%`,
                    borderRadius: 3,
                    background: complete ? '#27ae60' : done > 0 ? '#e67e22' : '#555',
                    transition: 'width 0.4s',
                  }} />
                </div>
              )
            })()}

            {/* Items list */}
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginBottom: 12 }}>
              {selected.items.map(item => (
                <div key={item.id} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px', opacity: item.completed_at ? 0.65 : 1 }}>
                  {item.thumbnail_url && <img src={item.thumbnail_url} alt={item.title} style={{ width: 28, height: 40, objectFit: 'cover', borderRadius: 3 }} />}
                  <div>
                    <div style={{ fontSize: 13, fontWeight: 600 }}>{item.title}</div>
                    {item.completed_at && <div style={{ fontSize: 11, color: '#4caf50' }}>✓ Completed</div>}
                  </div>
                  {!item.completed_at && (
                    <button className="btn-ghost" style={{ fontSize: 11, padding: '2px 6px', color: '#e55', marginLeft: 4 }}
                      onClick={() => handleRemoveItem(selected, item)} disabled={busy}>✕</button>
                  )}
                </div>
              ))}
              {selected.items.length === 0 && (
                <div style={{ color: 'var(--text2)', fontSize: 13 }}>No entries yet.</div>
              )}
            </div>

            {/* Franchise movies not yet in this collection */}
            {selected.category === 'movies' && selected.external_id && (missingLoading || missing.length > 0) && (
              <div style={{ marginTop: 16, marginBottom: 4 }}>
                <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text2)', textTransform: 'uppercase', letterSpacing: '0.06em', marginBottom: 8 }}>
                  {missingLoading ? '⏳ Checking franchise…' : `🔍 ${missing.length} not in this collection`}
                </div>
                {!missingLoading && (
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                    {missing.map(m => {
                      const borderColor = m.finished ? '#27ae60' : m.in_library ? '#3498db' : 'var(--border)'
                      const badge = m.finished
                        ? { label: '✓ Finished', color: '#27ae60' }
                        : m.in_library
                          ? { label: '📚 In library', color: '#3498db' }
                          : { label: '○ Not watched', color: 'var(--text2)' }
                      return (
                        <div key={m.tmdb_id} style={{ display: 'flex', alignItems: 'center', gap: 8, background: 'var(--bg)', border: `1px ${m.in_library ? 'solid' : 'dashed'} ${borderColor}`, borderRadius: 6, padding: '6px 10px', opacity: m.in_library ? 1 : 0.55 }}>
                          {m.poster_url && <img src={m.poster_url} alt={m.title} style={{ width: 24, height: 34, objectFit: 'cover', borderRadius: 2, filter: m.in_library ? 'none' : 'grayscale(60%)' }} />}
                          <div>
                            <div style={{ fontSize: 13, fontWeight: 600 }}>{m.title}</div>
                            <div style={{ display: 'flex', gap: 6, alignItems: 'center', marginTop: 2 }}>
                              {m.release_date && <span style={{ fontSize: 11, color: 'var(--text2)' }}>{m.release_date.slice(0, 4)}</span>}
                              <span style={{ fontSize: 11, color: badge.color, fontWeight: 600 }}>{badge.label}</span>
                            </div>
                          </div>
                        </div>
                      )
                    })}
                  </div>
                )}
              </div>
            )}

            {/* Add item picker */}
            {addingItem ? (
              <div>
                <input autoFocus value={itemSearch} onChange={e => setItemSearch(e.target.value)}
                  placeholder={`Search ${CATEGORY_LABELS[selected.category]} library…`} className="input"
                  style={{ width: '100%', marginBottom: 8 }} />
                <div style={{ maxHeight: 240, overflowY: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  {filteredLibrary.slice(0, 30).map(li => (
                    <button key={li.id} className="btn-ghost"
                      style={{ display: 'flex', alignItems: 'center', gap: 8, justifyContent: 'flex-start', padding: '6px 10px', borderRadius: 6 }}
                      onClick={() => handleAddItem(selected, li)} disabled={busy}>
                      {li.thumbnail_url && <img src={li.thumbnail_url} alt={li.title} style={{ width: 24, height: 34, objectFit: 'cover', borderRadius: 2 }} />}
                      <span style={{ fontSize: 13 }}>{li.title}</span>
                    </button>
                  ))}
                  {filteredLibrary.length === 0 && <div style={{ color: 'var(--text2)', fontSize: 13, padding: 8 }}>No matching items</div>}
                </div>
                <button className="btn-ghost" style={{ marginTop: 8 }} onClick={() => setAddingItem(false)}>Cancel</button>
              </div>
            ) : (
              <button className="btn-secondary" onClick={() => handleOpenAddItem(selected)} style={{ fontSize: 13 }}>+ Add entry</button>
            )}
          </div>
        </div>
      )}
    </div>
  )
}
