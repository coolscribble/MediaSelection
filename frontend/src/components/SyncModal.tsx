import { useState } from 'react'
import { syncAniList, syncSimkl, syncMAL } from '../api'
import { toast, dismiss } from '../notifications'

interface Props { onClose: () => void }

export default function SyncModal({ onClose }: Props) {
  const [busy, setBusy] = useState<string | null>(null)
  const [results, setResults] = useState<Record<string, string>>({})

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

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <span>⟳ Sync</span>
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
        </div>
        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose}>Close</button>
        </div>
      </div>
    </div>
  )
}
