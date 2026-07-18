import { useState, useRef } from 'react'
import { CATEGORIES, CATEGORY_LABELS, CATEGORY_ICONS, Category } from '../types'
import { syncAniList, syncSimkl, syncMAL, importCSV } from '../api'

interface Props { onClose: () => void }

export default function SyncModal({ onClose }: Props) {
  const [busy, setBusy] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, string>>({})
  const fileRefs = useRef<Record<string, HTMLInputElement | null>>({})

  const setResult = (key: string, msg: string) => setResults(p => ({ ...p, [key]: msg }))

  const doSync = async (key: string, fn: () => Promise<unknown>) => {
    setBusy(key)
    try {
      const r = await fn() as Record<string, number>
      const parts = Object.entries(r).filter(([, v]) => typeof v === 'number').map(([k, v]) => `${k}: +${v}`).join(', ')
      setResult(key, `✓ ${parts || 'done'}`)
    } catch (e: unknown) {
      setResult(key, `✗ ${e instanceof Error ? e.message : 'Error'}`)
    } finally {
      setBusy(null)
    }
  }

  const doImport = async (category: Category, file: File) => {
    setBusy(category)
    try {
      const r = await importCSV(category, file) as { imported: number }
      setResult(category, `✓ Imported ${r.imported} items`)
    } catch (e: unknown) {
      setResult(category, `✗ ${e instanceof Error ? e.message : 'Error'}`)
    } finally {
      setBusy(null)
      const ref = fileRefs.current[category]
      if (ref) ref.value = ''
    }
  }

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
              <button className="btn-primary" disabled={busy !== null} onClick={() => doSync('anilist', syncAniList)}>
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
              <button className="btn-primary" disabled={busy !== null} onClick={() => doSync('simkl', syncSimkl)}>
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
              <button className="btn-primary" disabled={busy !== null} onClick={() => doSync('mal', syncMAL)}>
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
              <div key={cat} className="import-row">
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
                    onChange={e => { const f = e.target.files?.[0]; if (f) doImport(cat, f) }}
                  />
                </div>
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
