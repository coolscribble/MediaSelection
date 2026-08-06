import { useState, useEffect, useCallback } from 'react'
import { getCollections, createCollection, deleteCollection, addCollectionItem, removeCollectionItem, getLibrary, getCollectionMissing } from '../api'
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
  watched_outside: number   // franchise films finished in watched_items but not in collection_items
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
  const [missing, setMissing] = useState<MissingMovie[]>([])
  const [missingLoading, setMissingLoading] = useState(false)
  const [activeJob, setActiveJob] = useState<{ type: string; step: string; pct: number } | null>(null)

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

  const runJob = (type: string, url: string, onDone: (result: Record<string, number>) => string) => {
    if (activeJob) return
    setActiveJob({ type, step: 'Connecting…', pct: 0 })
    const es = new EventSource(url, { withCredentials: true })
    es.onmessage = (e) => {
      try {
        const data = JSON.parse(e.data) as { step?: string; pct?: number; done?: boolean; error?: boolean; result?: Record<string, number> }
        setActiveJob({ type, step: data.step || 'Working…', pct: data.pct ?? 50 })
        if (data.done) {
          es.close()
          setTimeout(() => {
            setActiveJob(null)
            load()
            onRefresh()
            if (data.error) toast(data.step || 'Operation failed', 'error')
            else toast(data.result ? onDone(data.result) : 'Done', 'success')
          }, 1200)
        }
      } catch { /* ignore */ }
    }
    es.onerror = () => {
      es.close()
      setActiveJob(null)
      toast(`${type} failed — check Settings → Connections`, 'error')
    }
  }

  const handleAutoDetect      = () => runJob('Auto-detect Movies', '/api/collections/auto-detect/movies',
    r => `Auto-detect: ${r.created} new collection(s) from ${r.checked} movies`)
  const handleAutoDetectAnime = () => runJob('Auto-detect Anime',  '/api/collections/auto-detect/anime',
    r => `Anime auto-detect: ${r.created} new collection(s), ${r.components} franchise groups`)

  const startSync = (source: 'simkl' | 'anilist' | 'jellyfin') =>
    runJob(
      source === 'simkl' ? 'Sync Simkl' : source === 'anilist' ? 'Sync AniList' : 'Sync Jellyfin',
      `/api/collections/sync-watched/${source}`,
      r => {
        const name = source === 'simkl' ? 'Simkl' : source === 'anilist' ? 'AniList' : 'Jellyfin'
        return `${name}: ${r.fetched} items saved, ${r.updated} collection entr${r.updated === 1 ? 'y' : 'ies'} marked as watched`
      }
    )

  const displayed =
    catFilter === 'finished'     ? collections.filter(c => completionOf(c).complete)
    : catFilter === 'not-finished' ? collections.filter(c => !completionOf(c).complete)
    : catFilter === 'all'          ? collections
    :                                collections.filter(c => c.category === catFilter)

  function completionOf(col: Collection) {
    const inCol   = col.items.length
    const doneInCol = col.items.filter(i => i.completed_at).length
    // watched_outside: franchise films watched (in watched_items) but not yet added to this collection.
    // Populated when the missing-movies panel loads; starts at 0 for collections never opened.
    const done    = doneInCol + (col.watched_outside ?? 0)
    const denom   = col.franchise_total ?? inCol   // use full franchise count when known
    return { inCol, done, denom, complete: denom >= 2 && done >= denom, pct: denom > 0 ? done / denom : 0 }
  }

  function bonusXp(col: Collection) {
    // Use the full franchise size (denom) so the bonus reflects all franchise entries,
    // not just items currently in the collection / still in the library.
    const { denom } = completionOf(col)
    return denom * (COLLECTION_BONUS_PER_ENTRY[col.category] || 10)
  }

  const openCollection = (col: Collection) => {
    setSelected(col)
    setMissing([])
    setAddingItem(false)
    if (col.category === 'movies' && col.external_id) {
      setMissingLoading(true)
      getCollectionMissing(col.id)
        .then((d: unknown) => {
          const resp = d as { missing: MissingMovie[]; franchise_total?: number; watched_outside?: number }
          setMissing(resp.missing || [])
          // Patch franchise_total and watched_outside onto both selected and the collection list.
          // watched_outside counts franchise films finished in watched_items but not in collection_items,
          // so the progress bar reflects movies watched before they were added to the collection.
          const patch = (c: Collection) =>
            c.id === col.id ? {
              ...c,
              ...(resp.franchise_total  != null ? { franchise_total:  resp.franchise_total  } : {}),
              ...(resp.watched_outside  != null ? { watched_outside:  resp.watched_outside  } : {}),
            } : c
          setCollections(prev => prev.map(patch))
          setSelected(prev => prev ? patch(prev) : prev)
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
        <button className="btn-ghost" onClick={() => startSync('simkl')} disabled={!!activeJob}
          title="Fetch all completed movies, TV shows & anime from Simkl and save to watched database">
          {activeJob?.type === 'Sync Simkl' ? '⏳ Syncing…' : '🔄 Sync Simkl'}
        </button>
        <button className="btn-ghost" onClick={() => startSync('anilist')} disabled={!!activeJob}
          title="Fetch all completed anime & manga from AniList and save to watched database">
          {activeJob?.type === 'Sync AniList' ? '⏳ Syncing…' : '🔄 Sync AniList'}
        </button>
        <button className="btn-ghost" onClick={() => startSync('jellyfin')} disabled={!!activeJob}
          title="Fetch all played items from your Jellyfin server and mark matching collection entries as watched">
          {activeJob?.type === 'Sync Jellyfin' ? '⏳ Syncing…' : '🎬 Sync Jellyfin'}
        </button>
        <button className="btn-ghost" onClick={handleAutoDetectAnime} disabled={!!activeJob} title="Group anime seasons/sequels via AniList relations">
          {activeJob?.type === 'Auto-detect Anime' ? '⏳ Working…' : '⛩ Auto-detect Anime'}
        </button>
        <button className="btn-ghost" onClick={handleAutoDetect} disabled={!!activeJob} title="Detect movie franchises via TMDB">
          {activeJob?.type === 'Auto-detect Movies' ? '⏳ Working…' : '🎬 Auto-detect Movies'}
        </button>
        <button className="btn-primary" onClick={() => setCreating(true)}>+ New Collection</button>
      </div>

      {/* Sync progress bar */}
      {activeJob && (
        <div style={{ padding: '8px 20px', background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 5, fontSize: 12, color: 'var(--text2)' }}>
            <span><strong>{activeJob.type}</strong> — {activeJob.step}</span>
            <span style={{ fontVariantNumeric: 'tabular-nums' }}>{activeJob.pct}%</span>
          </div>
          <div style={{ height: 5, borderRadius: 3, background: 'var(--border)', overflow: 'hidden' }}>
            <div style={{
              height: '100%',
              width: `${activeJob.pct}%`,
              borderRadius: 3,
              background: activeJob.pct === 100 ? '#27ae60' : 'var(--accent)',
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
