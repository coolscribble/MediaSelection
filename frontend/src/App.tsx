import { useState, useEffect, useCallback, useRef } from 'react'
import { CATEGORIES, CATEGORY_LABELS, CATEGORY_ICONS, SlotsData, Settings, User } from './types'
import { getSlots, getSettings, getStats, updateMetadata, refreshCategoryCovers, getMe, logout } from './api'
import { toast, dismiss } from './notifications'
import CategorySection from './components/CategorySection'
import SettingsModal from './components/SettingsModal'
import SyncModal from './components/SyncModal'
import OngoingSection from './components/OngoingSection'
import ToastContainer from './components/ToastContainer'
import LoginPage from './components/LoginPage'
import PublicProfilePage from './components/PublicProfilePage'

const COVER_OPTIONS = [
  { key: 'series', label: '📺 Series (Simkl)',                     cat: 'series' },
  { key: 'anime',  label: '⛩️ Anime (AniList)',                    cat: 'anime'  },
  { key: 'manga',  label: '📚 Manga (AniList)',                    cat: 'manga'  },
  { key: 'games',  label: '🎮 Games (IGDB)',                       cat: 'games'  },
  { key: 'albums', label: '🎵 Albums (iTunes)',                    cat: 'albums' },
  { key: 'comics', label: '💬 Comics (Google Books)',              cat: 'comics' },
]

const publicProfileMatch = window.location.pathname.match(/^\/user\/([^/]+)\/?$/)

export default function App() {
  if (publicProfileMatch) {
    return <PublicProfilePage username={publicProfileMatch[1]} />
  }
  const [user, setUser] = useState<User | null>(null)
  const [authChecked, setAuthChecked] = useState(false)
  const [slots, setSlots] = useState<SlotsData | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [statCounts, setStatCounts] = useState<Record<string, number>>({})
  const [statProgress, setStatProgress] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [syncOpen, setSyncOpen] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [coversOpen, setCoversOpen] = useState(false)
  const [coversSelected, setCoversSelected] = useState<Record<string, boolean>>({ series: true, anime: true, manga: true, games: true, albums: true, comics: true })
  const [coversBusy, setCoversBusy] = useState(false)
  const coversRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    getMe()
      .then((u: User) => { setUser(u); setAuthChecked(true) })
      .catch(() => { setUser(null); setAuthChecked(true) })
  }, [])

  const handleLogin = (u: User) => {
    setUser(u)
  }

  const handleLogout = async () => {
    try { await logout() } catch { /* ignore */ }
    setUser(null)
    setSlots(null)
    setSettings(null)
  }

  const refresh = useCallback(async () => {
    try {
      const [s, cfg, st] = await Promise.all([getSlots(), getSettings(), getStats()])
      const stTyped = st as { counts: Record<string, number>; progress: Record<string, number> }
      setSlots(s)
      setSettings(cfg)
      setStatCounts(stTyped.counts ?? {})
      setStatProgress(stTyped.progress ?? {})
    } catch (e) { console.error(e) }
    finally { setLoading(false) }
  }, [])

  useEffect(() => { if (user) refresh() }, [user, refresh])

  // Close covers popup when clicking outside
  useEffect(() => {
    if (!coversOpen) return
    const handler = (e: MouseEvent) => {
      if (coversRef.current && !coversRef.current.contains(e.target as Node)) {
        setCoversOpen(false)
      }
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [coversOpen])

  const handleUpdate = async () => {
    setUpdating(true)
    const tid = toast('Updating metadata from APIs…', 'info', true)
    try {
      await updateMetadata()
      await refresh()
      dismiss(tid)
      toast('Metadata updated', 'success')
    } catch (e: unknown) {
      dismiss(tid)
      toast((e instanceof Error ? e.message : 'Update failed'), 'error')
    } finally { setUpdating(false) }
  }

  const handleCovers = async () => {
    const toRun = COVER_OPTIONS.filter(o => coversSelected[o.key])
    if (!toRun.length) { setCoversOpen(false); return }
    setCoversBusy(true)
    setCoversOpen(false)
    const tid = toast(`Updating covers for: ${toRun.map(o => o.key).join(', ')}…`, 'info', true)
    try {
      const results = await Promise.allSettled(toRun.map(o => refreshCategoryCovers(o.cat)))
      dismiss(tid)
      const parts: string[] = []
      results.forEach((r, i) => {
        const label = toRun[i].key
        if (r.status === 'fulfilled') {
          const v = r.value as { updated?: number; skipped?: number; deleted?: number }
          let msg = `${label}: ${v.updated ?? 0} updated`
          if ((v.deleted ?? 0) > 0) msg += `, ${v.deleted} DLC removed`
          parts.push(msg)
        } else {
          parts.push(`${label}: failed`)
        }
      })
      toast(parts.join(' · '), 'success')
      await refresh()
    } catch (e: unknown) {
      dismiss(tid)
      toast(e instanceof Error ? e.message : 'Cover update failed', 'error')
    } finally { setCoversBusy(false) }
  }

  if (!authChecked) return <div className="loading">Loading…</div>
  if (!user) return <LoginPage onLogin={handleLogin} />
  if (loading) return <div className="loading">Loading…</div>

  return (
    <div>
      <header className="header">
        <h1>🎲 Media Picker</h1>
        <div className="header-actions">
          {/* Covers popup */}
          <div ref={coversRef} style={{ position: 'relative' }}>
            <button
              className="btn-ghost"
              onClick={() => setCoversOpen(v => !v)}
              disabled={coversBusy}
              title="Update cover art"
            >
              {coversBusy ? '…' : '🖼 Covers ▾'}
            </button>
            {coversOpen && (
              <div className="covers-popup">
                <div style={{ fontSize: 11, color: 'var(--text2)', marginBottom: 8, fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Update covers for:
                </div>
                {COVER_OPTIONS.map(opt => (
                  <label key={opt.key} className="covers-popup-option">
                    <input
                      type="checkbox"
                      checked={coversSelected[opt.key] ?? false}
                      onChange={() => setCoversSelected(prev => ({ ...prev, [opt.key]: !prev[opt.key] }))}
                    />
                    <span>{opt.label}</span>
                  </label>
                ))}
                <button
                  className="btn-primary"
                  style={{ marginTop: 4, width: '100%' }}
                  onClick={handleCovers}
                  disabled={!Object.values(coversSelected).some(Boolean)}
                >
                  Update Selected
                </button>
              </div>
            )}
          </div>

          <button className="btn-ghost" onClick={handleUpdate} disabled={updating} title="Refresh episode counts and airing dates from APIs (work in progress)">
            {updating ? '…' : '⟳ Update'}&nbsp;<span style={{ fontSize: 10, opacity: 0.45, fontWeight: 400 }}>WIP</span>
          </button>
          <button className="btn-secondary" onClick={() => setSyncOpen(true)}>⟳ Sync</button>
          <button className="btn-ghost" onClick={() => setSettingsOpen(true)}>⚙ Settings</button>
          <button className="btn-ghost" onClick={handleLogout} title={`Logged in as ${user.username}`} style={{ opacity: 0.7 }}>
            ⏻ {user.username}
          </button>
        </div>
      </header>

      <div className="stats-bar">
        <span className="stats-label">Finished:</span>
        {CATEGORIES.map(c => {
          const count = statCounts[c] ?? 0
          const prog  = statProgress[c] ?? 0
          const unit  = c === 'manga' || c === 'comics' ? 'ch' : c === 'series' || c === 'anime' ? 'ep' : null
          return (
            <span key={c} className="stats-item">
              {CATEGORY_ICONS[c]} {count} {CATEGORY_LABELS[c]}
              {unit && prog > 0 && <span className="stats-progress"> · {prog} {unit}</span>}
            </span>
          )
        })}
      </div>

      <main className="main-grid">
        {CATEGORIES.map(cat => (
          <CategorySection
            key={cat}
            category={cat}
            label={CATEGORY_LABELS[cat]}
            icon={CATEGORY_ICONS[cat]}
            slots={slots?.[cat] ?? []}
            queueMode={settings?.queue_modes?.[cat] ?? false}
            onRefresh={refresh}
          />
        ))}
      </main>

      <OngoingSection />

      <footer className="page-footer">
        For any questions feel free to DM Cipra on Discord
      </footer>

      {settingsOpen && <SettingsModal onClose={() => { setSettingsOpen(false); refresh() }} username={user.username} />}
      {syncOpen    && <SyncModal     onClose={() => { setSyncOpen(false);    refresh() }} />}
      <ToastContainer />
    </div>
  )
}
