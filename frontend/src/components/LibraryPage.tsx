import { useState, useEffect, useRef } from 'react'
import { Category, LibraryItem, CATEGORIES, CATEGORY_LABELS, CATEGORY_ICONS } from '../types'
import {
  getLibrary, addLibraryItem, deleteLibraryItem,
  importCSV, refreshCategoryCovers, refreshItemCover, previewCSVImport,
  updateLibraryItemCover, updateLibraryItemField, uploadLibraryItemCover, fetchComicVineCovers,
} from '../api'
import { toast, dismiss } from '../notifications'

interface Props {
  onBack: () => void
  onRefresh: () => void
}

const COVER_CATEGORIES: Category[] = ['games', 'albums', 'comics', 'anime', 'manga']

interface CSVPreview {
  platforms: string[]
  serviceValues: string[]
  filterColumns: { column: string; values: string[] }[]
  hasRetroAchievements: boolean
}

interface CVCandidate {
  id: number
  name: string
  start_year: string | null
  thumb: string | null
}

export default function LibraryPage({ onBack, onRefresh }: Props) {
  const [category, setCategory] = useState<Category>('games')
  const [items, setItems] = useState<LibraryItem[]>([])
  const [search, setSearch] = useState('')
  const [newTitle, setNewTitle] = useState('')
  const [newThumb, setNewThumb] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [refreshingAll, setRefreshingAll] = useState(false)
  const [refreshingItem, setRefreshingItem] = useState<number | null>(null)
  const [csvFile, setCsvFile] = useState<File | null>(null)
  const [csvPreview, setCsvPreview] = useState<CSVPreview | null>(null)
  const [selectedAcqTypes, setSelectedAcqTypes] = useState<Set<string>>(new Set())
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<string>>(new Set())
  const [retroOnly, setRetroOnly] = useState(false)
  const [previewLoading, setPreviewLoading] = useState(false)
  const [editingId, setEditingId] = useState<number | null>(null)
  const [editCoverUrl, setEditCoverUrl] = useState('')
  const [editCvId, setEditCvId] = useState('')
  const [coverBusy, setCoverBusy] = useState(false)
  const [reviewMode, setReviewMode] = useState(false)
  const [cvSyncing, setCvSyncing] = useState(false)
  const [showAdd, setShowAdd] = useState(false)

  const fileRef = useRef<HTMLInputElement>(null)
  const coverFileRef = useRef<HTMLInputElement>(null)

  const load = () => getLibrary(category).then(d => setItems(d as LibraryItem[])).catch(() => {})

  useEffect(() => {
    load()
    setEditingId(null)
    setSearch('')
    setReviewMode(false)
    setCsvFile(null)
    setCsvPreview(null)
    setShowAdd(false)
    setMsg('')
  }, [category])

  const filtered = items.filter(i => {
    if (reviewMode) return !!(i.metadata as Record<string, unknown>).cv_needs_review
    const q = search.toLowerCase()
    if (!q) return true
    if (i.title.toLowerCase().includes(q)) return true
    const romaji = typeof (i.metadata as Record<string, unknown>).romaji_title === 'string'
      ? ((i.metadata as Record<string, string>).romaji_title).toLowerCase()
      : ''
    return romaji.includes(q)
  })

  const reviewCount = items.filter(i => !!(i.metadata as Record<string, unknown>).cv_needs_review).length
  const editingItem = editingId !== null ? items.find(i => i.id === editingId) ?? null : null
  const hasCoverAPI = COVER_CATEGORIES.includes(category)

  const closeEdit = () => { setEditingId(null); setEditCoverUrl(''); setEditCvId('') }

  const handleAdd = async () => {
    if (!newTitle.trim()) return
    setBusy(true)
    try {
      await addLibraryItem(category, { title: newTitle.trim(), thumbnail_url: newThumb.trim() || undefined })
      setNewTitle(''); setNewThumb(''); setMsg('Added')
      load(); onRefresh()
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : 'Error')
    } finally { setBusy(false) }
  }

  const handleDelete = async (id: number) => {
    if (editingId === id) closeEdit()
    await deleteLibraryItem(id)
    load(); onRefresh()
  }

  const handleRefreshAll = async () => {
    setRefreshingAll(true)
    const tid = toast(`Refreshing all ${CATEGORY_LABELS[category]} covers…`, 'info', true)
    try {
      const r = await refreshCategoryCovers(category) as { updated?: number; skipped?: number; deleted?: number }
      dismiss(tid)
      const parts = [`${r.updated ?? 0} updated`, `${r.skipped ?? 0} not found`]
      if ((r.deleted ?? 0) > 0) parts.push(`${r.deleted} DLC removed`)
      toast(`${CATEGORY_LABELS[category]}: ${parts.join(', ')}`, 'success')
      load(); onRefresh()
    } catch (e: unknown) {
      dismiss(tid)
      toast(e instanceof Error ? e.message : 'Refresh failed', 'error')
    } finally { setRefreshingAll(false) }
  }

  const handleRefreshItem = async (itemId: number) => {
    setRefreshingItem(itemId)
    try { await refreshItemCover(category, itemId); load(); onRefresh() }
    catch { /* silent */ }
    finally { setRefreshingItem(null) }
  }

  const handleComicVineSync = async () => {
    setCvSyncing(true)
    const tid = toast('Fetching ComicVine covers…', 'info', true)
    try {
      const r = await fetchComicVineCovers() as { updated?: number; skipped?: number; needsReview?: number }
      dismiss(tid)
      const parts = [`${r.updated ?? 0} updated`, `${r.skipped ?? 0} not found`]
      if ((r.needsReview ?? 0) > 0) parts.push(`${r.needsReview} need review`)
      toast(`ComicVine: ${parts.join(', ')}`, 'success')
      load()
    } catch (e: unknown) {
      dismiss(tid)
      toast(e instanceof Error ? e.message : 'ComicVine sync failed', 'error')
    } finally { setCvSyncing(false) }
  }

  const handleApplyCoverUrl = async (itemId: number, clearReview = false) => {
    if (!editCoverUrl.trim() && !clearReview) return
    setCoverBusy(true)
    try {
      await updateLibraryItemCover(itemId, editCoverUrl.trim(), clearReview)
      closeEdit(); load()
    } catch { /* silent */ }
    finally { setCoverBusy(false) }
  }

  const handleCoverFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || editingId === null) return
    if (coverFileRef.current) coverFileRef.current.value = ''
    setCoverBusy(true)
    try {
      await uploadLibraryItemCover(editingId, file)
      closeEdit(); load()
    } catch { /* silent */ }
    finally { setCoverBusy(false) }
  }

  const handleSetCvId = async (itemId: number, cvId: string) => {
    if (!cvId.trim()) return
    setCoverBusy(true)
    try {
      await updateLibraryItemField(itemId, { external_id: cvId.trim(), clear_review: true })
      const result = await refreshItemCover(category, itemId) as { updated?: number; skipped?: number }
      closeEdit(); load(); onRefresh()
      if ((result.updated ?? 0) > 0) {
        toast('Cover updated from ComicVine', 'success')
      } else {
        toast('ComicVine ID saved — no cover found for this volume', 'info')
      }
    } catch (e: unknown) {
      toast(e instanceof Error ? e.message : 'Error setting ComicVine ID', 'error')
    } finally { setCoverBusy(false) }
  }

  const handlePickCandidate = async (itemId: number, thumb: string | null) => {
    if (!thumb) return
    setCoverBusy(true)
    try { await updateLibraryItemCover(itemId, thumb, true); load() }
    catch { /* silent */ }
    finally { setCoverBusy(false) }
  }

  const handleCSVSelect = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file) return
    if (fileRef.current) fileRef.current.value = ''
    if (category === 'games') {
      setCsvFile(file)
      setPreviewLoading(true)
      try {
        const preview = await previewCSVImport(category, file) as CSVPreview
        setCsvPreview(preview)
        setSelectedAcqTypes(new Set(preview.serviceValues))
        setSelectedPlatforms(new Set(preview.platforms))
        setRetroOnly(false)
      } catch {
        setCsvPreview({ platforms: [], serviceValues: [], filterColumns: [], hasRetroAchievements: false })
      } finally { setPreviewLoading(false) }
    } else {
      setBusy(true)
      try {
        const result = await importCSV(category, file) as { imported: number }
        setMsg(`Imported ${result.imported} items`)
        load(); onRefresh()
      } catch (err: unknown) {
        setMsg(err instanceof Error ? err.message : 'Import error')
      } finally { setBusy(false) }
    }
  }

  const handleCSVConfirm = async () => {
    if (!csvFile) return
    setBusy(true)
    try {
      const platformArr = selectedPlatforms.size > 0 && csvPreview?.platforms.length && selectedPlatforms.size < csvPreview.platforms.length
        ? [...selectedPlatforms] : undefined
      const acqArr = selectedAcqTypes.size > 0 && csvPreview?.serviceValues.length
        ? [...selectedAcqTypes] : undefined
      const result = await importCSV(category, csvFile, platformArr, acqArr, retroOnly) as { imported: number; refreshed: number }
      const refreshedStr = result.refreshed > 0 ? `, ${result.refreshed} refreshed` : ''
      setMsg(`Imported ${result.imported} new${refreshedStr}`)
      setCsvFile(null); setCsvPreview(null)
      load(); onRefresh()
    } catch (err: unknown) {
      setMsg(err instanceof Error ? err.message : 'Import error')
    } finally { setBusy(false) }
  }

  const toggleAcqType = (t: string) => setSelectedAcqTypes(prev => { const n = new Set(prev); n.has(t) ? n.delete(t) : n.add(t); return n })
  const togglePlatform = (p: string) => setSelectedPlatforms(prev => { const n = new Set(prev); n.has(p) ? n.delete(p) : n.add(p); return n })

  const inputStyle: React.CSSProperties = {
    background: 'var(--surface2)', border: '1px solid var(--border)',
    borderRadius: 6, color: 'var(--text)', padding: '6px 10px', fontSize: 12,
  }

  return (
    <div style={{ minHeight: '100vh', display: 'flex', flexDirection: 'column', background: 'var(--bg)' }}>

      {/* Page header */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '12px 20px', background: 'var(--surface)', borderBottom: '1px solid var(--border)', flexWrap: 'wrap', position: 'sticky', top: 30, zIndex: 10 }}>
        <button className="btn-ghost" onClick={onBack} style={{ flexShrink: 0, padding: '6px 10px' }}>← Back</button>
        <span style={{ fontWeight: 700, fontSize: 16 }}>📋 Library</span>
        <span style={{ color: 'var(--text2)', fontSize: 13 }}>— {CATEGORY_ICONS[category]} {CATEGORY_LABELS[category]} ({items.length})</span>
        <div style={{ flex: 1 }} />
        {/* Category tabs */}
        <div style={{ display: 'flex', gap: 2, flexWrap: 'wrap' }}>
          {CATEGORIES.map(c => (
            <button
              key={c}
              onClick={() => setCategory(c)}
              style={{
                padding: '5px 11px', fontSize: 12, fontWeight: category === c ? 700 : 400,
                background: category === c ? 'var(--accent)' : 'var(--surface2)',
                color: category === c ? '#fff' : 'var(--text2)',
                border: '1px solid ' + (category === c ? 'var(--accent)' : 'var(--border)'),
                borderRadius: 6, cursor: 'pointer', transition: 'all 0.12s',
              }}
            >
              {CATEGORY_ICONS[c]} {CATEGORY_LABELS[c]}
            </button>
          ))}
        </div>
      </div>

      {/* Toolbar */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 20px', background: 'var(--surface2)', borderBottom: '1px solid var(--border)', flexWrap: 'wrap' }}>
        {!reviewMode && (
          <input
            style={{ ...inputStyle, padding: '7px 12px', fontSize: 13, width: 200 }}
            placeholder="🔍 Search…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        )}
        <button className="btn-secondary" onClick={() => setShowAdd(v => !v)} style={{ fontSize: 12 }}>+ Add item</button>
        <button className="btn-secondary" onClick={() => fileRef.current?.click()} disabled={busy || previewLoading} style={{ fontSize: 12 }}>
          📥 Import CSV
        </button>
        <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleCSVSelect} />
        {hasCoverAPI && category !== 'comics' && (
          <button className="btn-secondary" onClick={handleRefreshAll} disabled={refreshingAll || busy} style={{ fontSize: 12 }}>
            {refreshingAll ? '…' : '🖼 Refresh All Covers'}
          </button>
        )}
        {category === 'comics' && (
          <button className="btn-secondary" onClick={handleComicVineSync} disabled={cvSyncing || busy} style={{ fontSize: 12 }}>
            {cvSyncing ? '…' : '🎨 ComicVine Sync'}
          </button>
        )}
        {category === 'comics' && reviewCount > 0 && (
          <button
            className="btn-secondary"
            onClick={() => { setReviewMode(r => !r); setSearch('') }}
            style={{ fontSize: 12, color: reviewMode ? 'var(--text)' : 'var(--warning, #e6a817)', borderColor: reviewMode ? undefined : 'var(--warning, #e6a817)' }}
          >
            {reviewMode ? '← All comics' : `🔍 ${reviewCount} need review`}
          </button>
        )}
        {msg && (
          <span style={{ fontSize: 12, color: msg.startsWith('Import') || msg.startsWith('Added') ? 'var(--success)' : 'var(--danger)' }}>
            {msg}
          </span>
        )}
      </div>

      {/* Add item form */}
      {showAdd && (
        <div style={{ display: 'flex', gap: 8, padding: '10px 20px', background: 'var(--surface)', borderBottom: '1px solid var(--border)', flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            style={{ ...inputStyle, flex: 1, minWidth: 180, padding: '7px 10px', fontSize: 13 }}
            placeholder="Title…"
            value={newTitle}
            onChange={e => setNewTitle(e.target.value)}
            onKeyDown={e => e.key === 'Enter' && handleAdd()}
            autoFocus
          />
          <input
            style={{ ...inputStyle, width: 180, padding: '7px 10px', fontSize: 13 }}
            placeholder="Image URL (optional)"
            value={newThumb}
            onChange={e => setNewThumb(e.target.value)}
          />
          <button className="btn-primary" onClick={handleAdd} disabled={busy || !newTitle.trim()}>+ Add</button>
          <button className="btn-ghost" onClick={() => { setShowAdd(false); setNewTitle(''); setNewThumb('') }}>Cancel</button>
        </div>
      )}

      {/* Games CSV filter step */}
      {category === 'games' && csvFile && (
        <div style={{ padding: '14px 20px', background: 'var(--surface)', borderBottom: '1px solid var(--border)' }}>
          {previewLoading ? (
            <div style={{ color: 'var(--text2)', fontSize: 13 }}>Reading CSV…</div>
          ) : (
            <>
              <div style={{ fontWeight: 600, marginBottom: 8, fontSize: 13 }}>
                Import from: <span style={{ color: 'var(--text2)' }}>{csvFile.name}</span>
              </div>
              {csvPreview && csvPreview.platforms.length > 0 && (
                <>
                  <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 6 }}>Filter by gaming system (uncheck to exclude):</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                    {csvPreview.platforms.map(p => (
                      <label key={p} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, cursor: 'pointer', background: 'var(--surface2)', padding: '4px 10px', borderRadius: 6, border: selectedPlatforms.has(p) ? '1px solid var(--accent)' : '1px solid var(--border)' }}>
                        <input type="checkbox" checked={selectedPlatforms.has(p)} onChange={() => togglePlatform(p)} />
                        {p}
                      </label>
                    ))}
                  </div>
                </>
              )}
              {csvPreview && csvPreview.serviceValues.length > 0 ? (
                <>
                  <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 6 }}>Filter by format / digital service (uncheck to exclude):</div>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 12 }}>
                    {csvPreview.serviceValues.map(t => (
                      <label key={t} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, cursor: 'pointer', background: 'var(--surface2)', padding: '4px 10px', borderRadius: 6, border: selectedAcqTypes.has(t) ? '1px solid var(--accent)' : '1px solid var(--border)' }}>
                        <input type="checkbox" checked={selectedAcqTypes.has(t)} onChange={() => toggleAcqType(t)} />
                        {t}
                      </label>
                    ))}
                  </div>
                </>
              ) : csvPreview && (
                <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 10 }}>No acquisition type filter detected — will import all games.</div>
              )}
              {csvPreview?.hasRetroAchievements && (
                <div style={{ marginBottom: 12 }}>
                  <label style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12, cursor: 'pointer' }}>
                    <input type="checkbox" checked={retroOnly} onChange={e => setRetroOnly(e.target.checked)} />
                    <span>Only import games with Retro Achievements data</span>
                  </label>
                </div>
              )}
              <div style={{ display: 'flex', gap: 8 }}>
                <button className="btn-primary" onClick={handleCSVConfirm} disabled={busy}>{busy ? 'Importing…' : '✓ Import'}</button>
                <button className="btn-ghost" onClick={() => { setCsvFile(null); setCsvPreview(null) }}>Cancel</button>
              </div>
            </>
          )}
        </div>
      )}

      {/* Review mode hint */}
      {reviewMode && (
        <div style={{ background: 'var(--surface2)', padding: '8px 20px', fontSize: 12, color: 'var(--text2)', borderBottom: '1px solid var(--border)' }}>
          ComicVine found multiple volumes for these titles. Click a candidate cover to apply it, or use ✏ to set the ID manually.
        </div>
      )}

      {/* Tile grid */}
      <div style={{ flex: 1, padding: '20px', paddingBottom: editingItem ? 140 : 20, overflowY: 'auto' }}>
        {filtered.length === 0 ? (
          <div style={{ color: 'var(--text2)', fontSize: 14, textAlign: 'center', paddingTop: 60 }}>
            {reviewMode ? 'No items need review.' : search ? `No results for "${search}".` : `No items in ${CATEGORY_LABELS[category]} yet.`}
          </div>
        ) : (
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-start' }}>
            {filtered.map(item => {
              const meta = item.metadata as Record<string, unknown>
              const artist   = category === 'albums' ? (meta.artist as string || '') : ''
              const author   = category === 'comics' ? (meta.author as string || '') : ''
              const platform = category === 'games'
                ? ((meta.platform as string) || (Array.isArray(meta.platforms) ? (meta.platforms as string[]).slice(0, 2).join(', ') : ''))
                : ''
              const acqType      = category === 'games' ? (meta.acquisition_type as string || '') : ''
              const cvCandidates = (meta.cv_candidates || []) as CVCandidate[]
              const isEditing    = editingId === item.id
              const subtitle     = artist || author || platform || (typeof meta.status === 'string' ? meta.status : '')

              return (
                <div
                  key={item.id}
                  className="lib-tile"
                  style={{
                    width: 128,
                    background: 'var(--surface)',
                    border: isEditing ? '2px solid var(--accent)' : '1px solid var(--border)',
                    borderRadius: 8,
                    overflow: 'hidden',
                    flexShrink: 0,
                    transition: 'border-color 0.15s',
                  }}
                >
                  {/* Cover with hover overlay */}
                  <div style={{ position: 'relative', width: '100%', aspectRatio: '2/3', background: 'var(--border)' }}>
                    {item.thumbnail_url
                      ? <img src={item.thumbnail_url} alt={item.title} style={{ width: '100%', height: '100%', objectFit: 'cover', display: 'block' }} />
                      : <div style={{ width: '100%', height: '100%', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 32 }}>
                          {CATEGORY_ICONS[category]}
                        </div>
                    }
                    {/* Hover action overlay */}
                    <div className="lib-tile-overlay">
                      <button
                        className="btn-icon"
                        title={isEditing ? 'Close edit' : 'Edit cover / ID'}
                        onClick={() => isEditing ? closeEdit() : (setEditingId(item.id), setEditCoverUrl(''), setEditCvId(''))}
                        style={{ fontSize: 13, width: 28, height: 28 }}
                      >
                        {isEditing ? '✕' : '✏'}
                      </button>
                      {hasCoverAPI && (
                        <button
                          className="btn-icon"
                          title="Refresh cover"
                          onClick={() => handleRefreshItem(item.id)}
                          disabled={refreshingItem === item.id}
                          style={{ fontSize: 13, width: 28, height: 28 }}
                        >
                          {refreshingItem === item.id ? '…' : '⟳'}
                        </button>
                      )}
                      <button
                        className="btn-danger"
                        style={{ fontSize: 10, padding: '3px 7px' }}
                        onClick={() => handleDelete(item.id)}
                      >
                        ✕
                      </button>
                    </div>
                    {!!meta.is_dlc && (
                      <div style={{ position: 'absolute', top: 4, left: 4, background: 'var(--danger)', color: '#fff', fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3, pointerEvents: 'none' }}>DLC</div>
                    )}
                    {!!(meta as Record<string, unknown>).cv_needs_review && (
                      <div style={{ position: 'absolute', top: 4, right: 4, background: 'var(--warning)', color: '#1a1a1a', fontSize: 9, fontWeight: 700, padding: '1px 5px', borderRadius: 3, pointerEvents: 'none' }}>Review</div>
                    )}
                  </div>

                  {/* Title + subtitle */}
                  <div style={{ padding: '6px 7px 7px' }}>
                    <div style={{ fontSize: 11, fontWeight: 600, lineHeight: 1.35, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' }}>
                      {item.title}
                    </div>
                    {(subtitle || acqType) && (
                      <div style={{ fontSize: 10, color: 'var(--text2)', marginTop: 2, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
                        {subtitle}{acqType && <span style={{ color: 'var(--accent)' }}>{subtitle ? ' · ' : ''}{acqType}</span>}
                      </div>
                    )}
                  </div>

                  {/* ComicVine review candidates */}
                  {reviewMode && cvCandidates.length > 0 && (
                    <div style={{ padding: '4px 6px 8px', borderTop: '1px solid var(--border)', display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                      <div style={{ width: '100%', fontSize: 10, color: 'var(--text2)', marginBottom: 2 }}>Pick cover:</div>
                      {cvCandidates.map(c => (
                        <div
                          key={c.id}
                          title={`${c.name}${c.start_year ? ` (${c.start_year})` : ''}`}
                          style={{ cursor: c.thumb ? 'pointer' : 'default', textAlign: 'center' }}
                          onClick={() => c.thumb && handlePickCandidate(item.id, c.thumb)}
                        >
                          {c.thumb
                            ? <img src={c.thumb} alt={c.name} style={{ width: 36, height: 50, objectFit: 'cover', borderRadius: 3, border: '1px solid var(--border)', display: 'block' }} />
                            : <div style={{ width: 36, height: 50, borderRadius: 3, background: 'var(--surface2)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 9, color: 'var(--text2)' }}>?</div>
                          }
                          <div style={{ fontSize: 9, color: 'var(--text2)', marginTop: 1 }}>{c.start_year ?? '?'}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </div>

      {/* Sticky edit panel */}
      {editingItem && (
        <div style={{
          position: 'sticky', bottom: 0, background: 'var(--surface)',
          borderTop: '2px solid var(--accent)', padding: '10px 20px',
          display: 'flex', flexDirection: 'column', gap: 8, zIndex: 20,
          boxShadow: '0 -4px 20px rgba(0,0,0,0.4)',
        }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--accent)', flexShrink: 0 }}>
              ✏ Editing: {editingItem.title}
            </span>
            <div style={{ flex: 1 }} />
            <button className="btn-ghost" style={{ fontSize: 11, padding: '3px 8px' }} onClick={closeEdit}>✕ Close</button>
          </div>

          {/* Cover URL */}
          <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
            <input
              style={{ flex: 1, minWidth: 160, ...inputStyle }}
              placeholder="Paste image URL…"
              value={editCoverUrl}
              onChange={e => setEditCoverUrl(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleApplyCoverUrl(editingItem.id, reviewMode)}
            />
            <button className="btn-secondary" style={{ fontSize: 11, padding: '4px 8px' }}
              onClick={() => coverFileRef.current?.click()} disabled={coverBusy}>
              📁 File
            </button>
            <button className="btn-primary" style={{ fontSize: 11, padding: '4px 8px' }}
              onClick={() => handleApplyCoverUrl(editingItem.id, reviewMode)} disabled={coverBusy || !editCoverUrl.trim()}>
              Apply cover
            </button>
            {reviewMode && (
              <button className="btn-secondary" style={{ fontSize: 11, padding: '4px 8px' }}
                onClick={() => handleApplyCoverUrl(editingItem.id, true)} disabled={coverBusy}>
                Skip
              </button>
            )}
          </div>

          {/* ComicVine ID row */}
          {category === 'comics' && (
            <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
              <span style={{ fontSize: 11, color: 'var(--text2)', whiteSpace: 'nowrap' }}>
                ComicVine ID{editingItem.external_id ? ` (current: ${editingItem.external_id})` : ' (not set)'}:
              </span>
              <input
                style={{ width: 120, ...inputStyle }}
                placeholder="e.g. 18765"
                value={editCvId}
                onChange={e => setEditCvId(e.target.value.replace(/\D/g, ''))}
                onKeyDown={e => e.key === 'Enter' && handleSetCvId(editingItem.id, editCvId)}
              />
              <button className="btn-primary" style={{ fontSize: 11, padding: '4px 8px' }}
                onClick={() => handleSetCvId(editingItem.id, editCvId)} disabled={coverBusy || !editCvId.trim()}>
                Set ID & Resync
              </button>
              <span style={{ fontSize: 10, color: 'var(--text2)' }}>
                Find the ID on comicvine.gamespot.com in the volume URL
              </span>
            </div>
          )}
        </div>
      )}

      <input ref={coverFileRef} type="file" accept="image/*" style={{ display: 'none' }} onChange={handleCoverFileChange} />
    </div>
  )
}
