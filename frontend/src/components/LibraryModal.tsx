import { useState, useEffect, useRef } from 'react'
import { Category, LibraryItem } from '../types'
import {
  getLibrary, addLibraryItem, deleteLibraryItem,
  importCSV, refreshCategoryCovers, refreshItemCover, previewCSVImport,
  updateLibraryItemCover, updateLibraryItemField, uploadLibraryItemCover, fetchComicVineCovers,
} from '../api'
import { toast, dismiss } from '../notifications'

interface Props {
  category: Category
  label: string
  onClose: () => void
  onRefresh: () => void
}

const COVER_CATEGORIES: Category[] = ['games', 'albums', 'comics', 'anime', 'manga']

interface CSVPreview {
  platforms: string[]
  serviceValues: string[]
  filterColumns: { column: string; values: string[] }[]
}

interface CVCandidate {
  id: number
  name: string
  start_year: string | null
  thumb: string | null
}

export default function LibraryModal({ category, label, onClose, onRefresh }: Props) {
  const [items, setItems] = useState<LibraryItem[]>([])
  const [search, setSearch] = useState('')
  const [newTitle, setNewTitle] = useState('')
  const [newThumb, setNewThumb] = useState('')
  const [busy, setBusy] = useState(false)
  const [msg, setMsg] = useState('')
  const [refreshingAll, setRefreshingAll] = useState(false)
  const [refreshingItem, setRefreshingItem] = useState<number | null>(null)
  // CSV import
  const [csvFile, setCsvFile] = useState<File | null>(null)
  const [csvPreview, setCsvPreview] = useState<CSVPreview | null>(null)
  const [selectedAcqTypes, setSelectedAcqTypes] = useState<Set<string>>(new Set())
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<string>>(new Set())
  const [previewLoading, setPreviewLoading] = useState(false)
  // Cover edit
  const [editingCoverId, setEditingCoverId] = useState<number | null>(null)
  const [editCoverUrl, setEditCoverUrl] = useState('')
  const [editCvId, setEditCvId] = useState('')
  const [coverBusy, setCoverBusy] = useState(false)
  // ComicVine review mode
  const [reviewMode, setReviewMode] = useState(false)
  const [cvSyncing, setCvSyncing] = useState(false)

  const fileRef = useRef<HTMLInputElement>(null)
  const coverFileRef = useRef<HTMLInputElement>(null)

  const load = () => getLibrary(category).then(d => setItems(d as LibraryItem[])).catch(() => {})

  useEffect(() => { load() }, [category])

  const filtered = items.filter(i => {
    if (reviewMode) {
      return !!(i.metadata as Record<string, unknown>).cv_needs_review
    }
    const q = search.toLowerCase()
    if (!q) return true
    if (i.title.toLowerCase().includes(q)) return true
    const romaji = typeof (i.metadata as Record<string, unknown>).romaji_title === 'string'
      ? ((i.metadata as Record<string, string>).romaji_title).toLowerCase()
      : ''
    return romaji.includes(q)
  })

  const reviewCount = items.filter(i => !!(i.metadata as Record<string, unknown>).cv_needs_review).length

  const handleAdd = async () => {
    if (!newTitle.trim()) return
    setBusy(true)
    try {
      await addLibraryItem(category, { title: newTitle.trim(), thumbnail_url: newThumb.trim() || undefined })
      setNewTitle(''); setNewThumb('')
      setMsg('Added')
      load(); onRefresh()
    } catch (e: unknown) {
      setMsg(e instanceof Error ? e.message : 'Error')
    } finally { setBusy(false) }
  }

  const handleDelete = async (id: number) => {
    await deleteLibraryItem(id)
    load(); onRefresh()
  }

  const handleRefreshAll = async () => {
    setRefreshingAll(true)
    const tid = toast(`Refreshing all ${label} covers…`, 'info', true)
    try {
      const r = await refreshCategoryCovers(category) as { updated?: number; skipped?: number; deleted?: number }
      dismiss(tid)
      const parts = [`${r.updated ?? 0} updated`, `${r.skipped ?? 0} not found`]
      if ((r.deleted ?? 0) > 0) parts.push(`${r.deleted} DLC removed`)
      toast(`${label}: ${parts.join(', ')}`, 'success')
      load(); onRefresh()
    } catch (e: unknown) {
      dismiss(tid)
      toast(e instanceof Error ? e.message : 'Refresh failed', 'error')
    } finally { setRefreshingAll(false) }
  }

  const handleRefreshItem = async (itemId: number) => {
    setRefreshingItem(itemId)
    try {
      await refreshItemCover(category, itemId)
      load(); onRefresh()
    } catch { /* silent */ }
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

  // Cover edit handlers
  const handleApplyCoverUrl = async (itemId: number, clearReview = false) => {
    if (!editCoverUrl.trim() && !clearReview) return
    setCoverBusy(true)
    try {
      await updateLibraryItemCover(itemId, editCoverUrl.trim(), clearReview)
      setEditingCoverId(null); setEditCoverUrl('')
      load()
    } catch { /* silent */ }
    finally { setCoverBusy(false) }
  }

  const handleCoverFileChange = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0]
    if (!file || editingCoverId === null) return
    if (coverFileRef.current) coverFileRef.current.value = ''
    setCoverBusy(true)
    try {
      await uploadLibraryItemCover(editingCoverId, file)
      setEditingCoverId(null); setEditCoverUrl('')
      load()
    } catch { /* silent */ }
    finally { setCoverBusy(false) }
  }

  const handleSetCvId = async (itemId: number, cvId: string) => {
    if (!cvId.trim()) return
    setCoverBusy(true)
    try {
      await updateLibraryItemField(itemId, { external_id: cvId.trim(), clear_review: true })
      const result = await refreshItemCover(category, itemId) as { updated?: number; skipped?: number }
      setEditingCoverId(null); setEditCvId('')
      load(); onRefresh()
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
    try {
      await updateLibraryItemCover(itemId, thumb, true)
      load()
    } catch { /* silent */ }
    finally { setCoverBusy(false) }
  }

  // CSV import handlers
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
      } catch {
        setCsvPreview({ platforms: [], serviceValues: [], filterColumns: [] })
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
        ? [...selectedPlatforms]
        : undefined
      const acqArr = selectedAcqTypes.size > 0 && csvPreview?.serviceValues.length
        ? [...selectedAcqTypes]
        : undefined
      const result = await importCSV(category, csvFile, platformArr, acqArr) as { imported: number; refreshed: number }
      const refreshedStr = result.refreshed > 0 ? `, ${result.refreshed} refreshed` : ''
      setMsg(`Imported ${result.imported} new${refreshedStr}`)
      setCsvFile(null); setCsvPreview(null)
      load(); onRefresh()
    } catch (err: unknown) {
      setMsg(err instanceof Error ? err.message : 'Import error')
    } finally { setBusy(false) }
  }

  const toggleAcqType = (t: string) => {
    setSelectedAcqTypes(prev => { const n = new Set(prev); n.has(t) ? n.delete(t) : n.add(t); return n })
  }
  const togglePlatform = (p: string) => {
    setSelectedPlatforms(prev => { const n = new Set(prev); n.has(p) ? n.delete(p) : n.add(p); return n })
  }

  const hasCoverAPI = COVER_CATEGORIES.includes(category)
  const inputStyle = { background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, color: 'var(--text)', padding: '6px 10px', fontSize: 12 }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 760 }}>
        <div className="modal-header">
          <span>📋 Library — {label} ({items.length})</span>
          <button className="btn-ghost" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">

          {/* Add manually */}
          <div style={{ display: 'flex', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <input
              style={{ flex: 1, ...inputStyle, padding: '7px 10px', fontSize: 13 }}
              placeholder="Add manually — title…"
              value={newTitle}
              onChange={e => setNewTitle(e.target.value)}
              onKeyDown={e => e.key === 'Enter' && handleAdd()}
            />
            <input
              style={{ width: 140, ...inputStyle, padding: '7px 10px', fontSize: 13 }}
              placeholder="Image URL (opt.)"
              value={newThumb}
              onChange={e => setNewThumb(e.target.value)}
            />
            <button className="btn-primary" onClick={handleAdd} disabled={busy || !newTitle.trim()}>+ Add</button>
          </div>

          {/* Actions row */}
          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12, flexWrap: 'wrap' }}>
            <button className="btn-secondary" onClick={() => fileRef.current?.click()} disabled={busy || previewLoading}>
              📥 Import CSV
            </button>
            <input ref={fileRef} type="file" accept=".csv" style={{ display: 'none' }} onChange={handleCSVSelect} />
            {hasCoverAPI && category !== 'comics' && (
              <button className="btn-secondary" onClick={handleRefreshAll} disabled={refreshingAll || busy}>
                {refreshingAll ? '…' : '🖼 Refresh All Covers'}
              </button>
            )}
            {category === 'comics' && (
              <button className="btn-secondary" onClick={handleComicVineSync} disabled={cvSyncing || busy}>
                {cvSyncing ? '…' : '🎨 ComicVine Sync'}
              </button>
            )}
            {category === 'comics' && reviewCount > 0 && (
              <button
                className="btn-secondary"
                onClick={() => { setReviewMode(r => !r); setSearch('') }}
                style={{ color: reviewMode ? 'var(--text)' : 'var(--warning, #e6a817)', borderColor: reviewMode ? undefined : 'var(--warning, #e6a817)' }}
              >
                {reviewMode ? '← All comics' : `🔍 ${reviewCount} need review`}
              </button>
            )}
            {msg && <span style={{ fontSize: 12, color: msg.startsWith('Import') || msg.startsWith('Added') ? 'var(--success)' : 'var(--danger)' }}>{msg}</span>}
          </div>

          {/* Review mode hint */}
          {reviewMode && (
            <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 12px', marginBottom: 10, fontSize: 12, color: 'var(--text2)' }}>
              ComicVine found multiple volumes for these titles. Click a candidate cover to apply it, or enter a URL manually.
            </div>
          )}

          {/* Games CSV filter step */}
          {category === 'games' && csvFile && (
            <div style={{ background: 'var(--surface2)', border: '1px solid var(--border)', borderRadius: 8, padding: 14, marginBottom: 12 }}>
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
                          <label key={p} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, cursor: 'pointer', background: 'var(--surface)', padding: '4px 10px', borderRadius: 6, border: selectedPlatforms.has(p) ? '1px solid var(--accent)' : '1px solid var(--border)' }}>
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
                          <label key={t} style={{ display: 'flex', alignItems: 'center', gap: 4, fontSize: 12, cursor: 'pointer', background: 'var(--surface)', padding: '4px 10px', borderRadius: 6, border: selectedAcqTypes.has(t) ? '1px solid var(--accent)' : '1px solid var(--border)' }}>
                            <input type="checkbox" checked={selectedAcqTypes.has(t)} onChange={() => toggleAcqType(t)} />
                            {t}
                          </label>
                        ))}
                      </div>
                    </>
                  ) : (
                    <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 10 }}>No acquisition type filter detected — will import all games.</div>
                  )}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn-primary" onClick={handleCSVConfirm} disabled={busy}>{busy ? 'Importing…' : '✓ Import'}</button>
                    <button className="btn-ghost" onClick={() => { setCsvFile(null); setCsvPreview(null) }}>Cancel</button>
                  </div>
                </>
              )}
            </div>
          )}

          <div className="divider" />

          {!reviewMode && (
            <div className="form-group lib-search">
              <input placeholder="Search library…" value={search} onChange={e => setSearch(e.target.value)} />
            </div>
          )}

          {/* Hidden file input for cover uploads */}
          <input
            ref={coverFileRef}
            type="file"
            accept="image/*"
            style={{ display: 'none' }}
            onChange={handleCoverFileChange}
          />

          <div className="lib-list">
            {filtered.length === 0 && (
              <div style={{ color: 'var(--text2)', fontSize: 13 }}>
                {reviewMode ? 'No items need review.' : 'No items'}
              </div>
            )}
            {filtered.map(item => {
              const meta = item.metadata as Record<string, unknown>
              const artist  = category === 'albums' ? (meta.artist  as string || '') : ''
              const author  = category === 'comics' ? (meta.author  as string || '') : ''
              const platform = category === 'games'
                ? ((meta.platform as string) || (Array.isArray(meta.platforms) ? (meta.platforms as string[]).slice(0, 2).join(', ') : ''))
                : ''
              const acqType = category === 'games' ? (meta.acquisition_type as string || '') : ''
              const cvCandidates = (meta.cv_candidates || []) as CVCandidate[]
              const isEditing = editingCoverId === item.id

              return (
                <div key={item.id}>
                  <div className="lib-item" style={{ cursor: 'default' }}>
                    {item.thumbnail_url
                      ? <img className="lib-thumb" src={item.thumbnail_url} alt={item.title} />
                      : <div className="lib-thumb-placeholder">📄</div>
                    }
                    <div className="lib-info" style={{ flex: 1, minWidth: 0 }}>
                      <div className="lib-name">{item.title}</div>
                      <div className="lib-source" style={{ display: 'flex', flexWrap: 'wrap', gap: '0 6px' }}>
                        <span>{item.source}</span>
                        {platform && <span>· {platform}</span>}
                        {artist && <span>· {artist}</span>}
                        {author && <span>· {author}</span>}
                        {acqType && <span style={{ color: 'var(--accent)' }}>· {acqType}</span>}
                        {typeof meta.status === 'string' && meta.status && <span>· {meta.status}</span>}
                        {!!meta.is_dlc && <span style={{ color: 'var(--danger)', fontWeight: 600 }}>· DLC</span>}
                      </div>
                    </div>
                    <div style={{ display: 'flex', gap: 4, flexShrink: 0 }}>
                      <button
                        className="btn-icon"
                        title="Edit cover / ID"
                        onClick={() => {
                          if (isEditing) { setEditingCoverId(null); setEditCoverUrl(''); setEditCvId('') }
                          else { setEditingCoverId(item.id); setEditCoverUrl(''); setEditCvId('') }
                        }}
                        style={{ fontSize: 12 }}
                      >
                        ✏
                      </button>
                      {hasCoverAPI && (
                        <button
                          className="btn-icon"
                          title="Refresh cover"
                          onClick={() => handleRefreshItem(item.id)}
                          disabled={refreshingItem === item.id}
                          style={{ fontSize: 12 }}
                        >
                          {refreshingItem === item.id ? '…' : '⟳'}
                        </button>
                      )}
                      <button
                        className="btn-danger"
                        style={{ fontSize: 11, padding: '3px 8px' }}
                        onClick={() => handleDelete(item.id)}
                      >✕</button>
                    </div>
                  </div>

                  {/* Inline edit row */}
                  {isEditing && (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, padding: '6px 8px 10px', background: 'var(--surface2)', borderRadius: '0 0 6px 6px', marginTop: -2 }}>
                      {/* Cover URL row */}
                      <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                        <input
                          style={{ flex: 1, minWidth: 160, ...inputStyle }}
                          placeholder="Paste image URL…"
                          value={editCoverUrl}
                          onChange={e => setEditCoverUrl(e.target.value)}
                          onKeyDown={e => e.key === 'Enter' && handleApplyCoverUrl(item.id, reviewMode)}
                        />
                        <button className="btn-secondary" style={{ fontSize: 11, padding: '4px 8px' }}
                          onClick={() => coverFileRef.current?.click()} disabled={coverBusy}>
                          📁 File
                        </button>
                        <button className="btn-primary" style={{ fontSize: 11, padding: '4px 8px' }}
                          onClick={() => handleApplyCoverUrl(item.id, reviewMode)} disabled={coverBusy || !editCoverUrl.trim()}>
                          Apply cover
                        </button>
                        {reviewMode && (
                          <button className="btn-secondary" style={{ fontSize: 11, padding: '4px 8px' }}
                            onClick={() => handleApplyCoverUrl(item.id, true)} disabled={coverBusy}>
                            Skip
                          </button>
                        )}
                        <button className="btn-ghost" style={{ fontSize: 11, padding: '4px 8px' }}
                          onClick={() => { setEditingCoverId(null); setEditCoverUrl(''); setEditCvId('') }}>
                          ✕
                        </button>
                      </div>

                      {/* ComicVine ID row — comics only */}
                      {category === 'comics' && (
                        <div style={{ display: 'flex', gap: 6, alignItems: 'center', flexWrap: 'wrap' }}>
                          <span style={{ fontSize: 11, color: 'var(--text2)', whiteSpace: 'nowrap' }}>
                            ComicVine ID{item.external_id ? ` (current: ${item.external_id})` : ' (not set)'}:
                          </span>
                          <input
                            style={{ width: 120, ...inputStyle }}
                            placeholder="e.g. 18765"
                            value={editCvId}
                            onChange={e => setEditCvId(e.target.value.replace(/\D/g, ''))}
                            onKeyDown={e => e.key === 'Enter' && handleSetCvId(item.id, editCvId)}
                          />
                          <button className="btn-primary" style={{ fontSize: 11, padding: '4px 8px' }}
                            onClick={() => handleSetCvId(item.id, editCvId)} disabled={coverBusy || !editCvId.trim()}>
                            Set ID & Resync
                          </button>
                          <span style={{ fontSize: 10, color: 'var(--text2)' }}>
                            Find the ID on comicvine.gamespot.com in the volume URL
                          </span>
                        </div>
                      )}
                    </div>
                  )}

                  {/* ComicVine review candidates */}
                  {reviewMode && cvCandidates.length > 0 && (
                    <div style={{ padding: '6px 8px 10px', background: 'var(--surface2)', borderTop: '1px solid var(--border)', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'flex-start' }}>
                      <span style={{ fontSize: 11, color: 'var(--text2)', alignSelf: 'center', flexShrink: 0 }}>Pick cover:</span>
                      {cvCandidates.map(c => (
                        <div
                          key={c.id}
                          title={`${c.name}${c.start_year ? ` (${c.start_year})` : ''}`}
                          style={{ cursor: c.thumb ? 'pointer' : 'default', textAlign: 'center' }}
                          onClick={() => c.thumb && handlePickCandidate(item.id, c.thumb)}
                        >
                          {c.thumb
                            ? <img src={c.thumb} alt={c.name} style={{ width: 48, height: 68, objectFit: 'cover', borderRadius: 4, border: '2px solid var(--border)', display: 'block' }} />
                            : <div style={{ width: 48, height: 68, borderRadius: 4, background: 'var(--surface)', border: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'var(--text2)' }}>No img</div>
                          }
                          <div style={{ fontSize: 10, color: 'var(--text2)', marginTop: 2 }}>{c.start_year ?? '?'}</div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
