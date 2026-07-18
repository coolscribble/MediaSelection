import { useState, useRef } from 'react'
import { CATEGORIES, CATEGORY_LABELS, CATEGORY_ICONS, Category } from '../types'
import { syncAniList, syncSimkl, syncMAL, importCSV } from '../api'
import { toast, dismiss } from '../notifications'

interface Props { onClose: () => void }

// Minimal CSV line parser that handles double-quoted fields
function parseCSVLine(line: string): string[] {
  const result: string[] = []
  let field = ''
  let inQuotes = false
  for (let i = 0; i < line.length; i++) {
    const c = line[i]
    if (c === '"') { inQuotes = !inQuotes }
    else if (c === ',' && !inQuotes) { result.push(field.trim()); field = '' }
    else { field += c }
  }
  result.push(field.trim())
  return result
}

export default function SyncModal({ onClose }: Props) {
  const [busy, setBusy] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, string>>({})
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({})

  // Games platform filter state
  const [gamesFile, setGamesFile] = useState<File | null>(null)
  const [allPlatforms, setAllPlatforms] = useState<string[]>([])
  const [selectedPlatforms, setSelectedPlatforms] = useState<Set<string>>(new Set())

  const setResult = (key: string, msg: string) => setResults(p => ({ ...p, [key]: msg }))

  const doSync = async (key: string, label: string, fn: () => Promise<unknown>) => {
    setBusy(key)
    const tid = toast(`Syncing ${label}…`, 'info', true)
    try {
      const r = await fn() as Record<string, number>
      const parts = Object.entries(r).filter(([, v]) => typeof v === 'number').map(([k, v]) => `${k}: +${v}`).join(', ')
      const msg = parts || 'done'
      setResult(key, `✓ ${msg}`)
      dismiss(tid)
      toast(`${label} synced — ${msg}`, 'success')
    } catch (e: unknown) {
      const err = e instanceof Error ? e.message : 'Error'
      setResult(key, `✗ ${err}`)
      dismiss(tid)
      toast(`${label} sync failed: ${err}`, 'error')
    } finally {
      setBusy(null)
    }
  }

  const doImport = async (category: Category, file: File, platforms?: string[]) => {
    setBusy(category)
    const label = `${CATEGORY_ICONS[category]} ${CATEGORY_LABELS[category]}`
    const tid = toast(`Importing ${label} CSV…`, 'info', true)
    try {
      const r = await importCSV(category, file, platforms) as { imported: number }
      setResult(category, `✓ Imported ${r.imported} items`)
      dismiss(tid)
      toast(`${label}: imported ${r.imported} items`, 'success')
    } catch (e: unknown) {
      const err = e instanceof Error ? e.message : 'Error'
      setResult(category, `✗ ${err}`)
      dismiss(tid)
      toast(`${label} import failed: ${err}`, 'error')
    } finally {
      setBusy(null)
      const ref = fileRefs.current[category]
      if (ref) ref.value = ''
    }
  }

  // When a games CSV is picked, extract unique platforms before importing
  const handleGamesFile = async (file: File) => {
    const text = await file.text()
    const lines = text.split(/\r?\n/).filter(l => l.trim())
    if (lines.length < 2) { doImport('games', file); return }

    const headers = parseCSVLine(lines[0])
    const platformIdx = headers.findIndex(h => h.replace(/^"|"$/g, '').toLowerCase() === 'platform')

    if (platformIdx === -1) { doImport('games', file); return }

    const platforms = new Set<string>()
    for (const line of lines.slice(1)) {
      const val = parseCSVLine(line)[platformIdx]?.trim()
      if (val) platforms.add(val)
    }

    if (platforms.size === 0) { doImport('games', file); return }

    const sorted = [...platforms].sort()
    setGamesFile(file)
    setAllPlatforms(sorted)
    setSelectedPlatforms(new Set(sorted)) // all selected by default
  }

  const confirmGamesImport = () => {
    if (!gamesFile) return
    const filter = selectedPlatforms.size < allPlatforms.length ? [...selectedPlatforms] : undefined
    doImport('games', gamesFile, filter)
    setGamesFile(null)
    setAllPlatforms([])
  }

  const togglePlatform = (p: string) =>
    setSelectedPlatforms(prev => {
      const next = new Set(prev)
      next.has(p) ? next.delete(p) : next.add(p)
      return next
    })

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>⟳ Sync & Import</span>
          <button className="btn-ghost" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="sync-section">
            <h3>⛩️ AniList — Anime + Manga</h3>
            <div className="sync-row">
              <button className="btn-primary" disabled={busy !== null} onClick={() => doSync('anilist', 'AniList', syncAniList)}>
                {busy === 'anilist' ? '…' : '⟳ Sync'}
              </button>
              {results.anilist && (
                <span className={`sync-status${results.anilist.startsWith('✓') ? ' ok' : ' err'}`}>
                  {results.anilist}
                </span>
              )}
            </div>
          </div>

          <div className="sync-section">
            <h3>🎬 Simkl — Movies + Series + Anime</h3>
            <div className="sync-row">
              <button className="btn-primary" disabled={busy !== null} onClick={() => doSync('simkl', 'Simkl', syncSimkl)}>
                {busy === 'simkl' ? '…' : '⟳ Sync'}
              </button>
              {results.simkl && (
                <span className={`sync-status${results.simkl.startsWith('✓') ? ' ok' : ' err'}`}>
                  {results.simkl}
                </span>
              )}
            </div>
          </div>

          <div className="sync-section">
            <h3>🎌 MyAnimeList — Anime + Manga</h3>
            <p style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 8 }}>
              Uses Jikan (public API). Set your MAL username in Settings. Profile must be public.
            </p>
            <div className="sync-row">
              <button className="btn-primary" disabled={busy !== null} onClick={() => doSync('mal', 'MyAnimeList', syncMAL)}>
                {busy === 'mal' ? '…' : '⟳ Sync'}
              </button>
              {results.mal && (
                <span className={`sync-status${results.mal.startsWith('✓') ? ' ok' : ' err'}`}>
                  {results.mal}
                </span>
              )}
            </div>
          </div>

          <div className="sync-section">
            <h3>📥 CSV Import</h3>
            <p style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 10 }}>
              Each row needs a <code>title</code> column (or <code>Game name</code> for InfiniteBacklog exports).
              Optional: <code>thumbnail</code>, <code>Platform</code>, <code>Status</code>.
            </p>
            {CATEGORIES.map(cat => (
              <div key={cat}>
                <div className="import-row">
                  <span className="import-label">{CATEGORY_ICONS[cat]} {CATEGORY_LABELS[cat]}</span>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                    {results[cat] && (
                      <span className={`sync-status${results[cat].startsWith('✓') ? ' ok' : ' err'}`} style={{ fontSize: 11 }}>
                        {results[cat]}
                      </span>
                    )}
                    <button
                      className="btn-secondary"
                      disabled={busy !== null}
                      onClick={() => fileRefs.current[cat]?.click()}
                      style={{ fontSize: 12, padding: '5px 10px' }}
                    >
                      {busy === cat ? '…' : '📂 CSV'}
                    </button>
                    <input
                      type="file"
                      accept=".csv"
                      style={{ display: 'none' }}
                      ref={el => { fileRefs.current[cat] = el }}
                      onChange={e => {
                        const f = e.target.files?.[0]
                        if (!f) return
                        if (cat === 'games') handleGamesFile(f)
                        else doImport(cat, f)
                      }}
                    />
                  </div>
                </div>

                {/* Platform filter — shown after picking a games CSV that has a Platform column */}
                {cat === 'games' && gamesFile && allPlatforms.length > 0 && (
                  <div className="platform-filter">
                    <div className="platform-filter-label">
                      Filter platforms ({selectedPlatforms.size}/{allPlatforms.length} selected):
                    </div>
                    <div className="platform-filter-grid">
                      {allPlatforms.map(p => (
                        <label key={p} className="platform-checkbox">
                          <input
                            type="checkbox"
                            checked={selectedPlatforms.has(p)}
                            onChange={() => togglePlatform(p)}
                          />
                          {p}
                        </label>
                      ))}
                    </div>
                    <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
                      <button className="btn-primary" onClick={confirmGamesImport} disabled={busy !== null || selectedPlatforms.size === 0} style={{ fontSize: 12 }}>
                        Import {selectedPlatforms.size === allPlatforms.length ? 'all' : `${selectedPlatforms.size} platform${selectedPlatforms.size !== 1 ? 's' : ''}`}
                      </button>
                      <button className="btn-ghost" onClick={() => { setGamesFile(null); setAllPlatforms([]) }} style={{ fontSize: 12 }}>
                        Cancel
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ))}
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
