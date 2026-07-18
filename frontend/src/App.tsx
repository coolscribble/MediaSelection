import { useState, useEffect, useCallback } from 'react'
import { CATEGORIES, CATEGORY_LABELS, CATEGORY_ICONS, SlotsData, Settings } from './types'
import { getSlots, getSettings, getStats, updateMetadata, fetchIGDBCovers } from './api'
import CategorySection from './components/CategorySection'
import SettingsModal from './components/SettingsModal'
import SyncModal from './components/SyncModal'
import OngoingSection from './components/OngoingSection'

export default function App() {
  const [slots, setSlots] = useState<SlotsData | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [statCounts, setStatCounts] = useState<Record<string, number>>({})
  const [statProgress, setStatProgress] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [syncOpen, setSyncOpen] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [updateMsg, setUpdateMsg] = useState('')
  const [igdbBusy, setIgdbBusy] = useState(false)
  const [igdbMsg, setIgdbMsg] = useState('')

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

  useEffect(() => { refresh() }, [refresh])

  const handleUpdate = async () => {
    setUpdating(true)
    setUpdateMsg('')
    try {
      await updateMetadata()
      await refresh()
      setUpdateMsg('✓ Updated')
    } catch (e: unknown) {
      setUpdateMsg('✗ ' + (e instanceof Error ? e.message : 'Error'))
    } finally {
      setUpdating(false)
      setTimeout(() => setUpdateMsg(''), 4000)
    }
  }

  const handleIGDB = async () => {
    setIgdbBusy(true)
    setIgdbMsg('')
    try {
      const r = await fetchIGDBCovers() as { updated?: number; skipped?: number; error?: string }
      if (r.error) throw new Error(r.error)
      await refresh()
      setIgdbMsg(`✓ ${r.updated ?? 0} covers`)
    } catch (e: unknown) {
      setIgdbMsg('✗ ' + (e instanceof Error ? e.message : 'Error'))
    } finally {
      setIgdbBusy(false)
      setTimeout(() => setIgdbMsg(''), 5000)
    }
  }

  if (loading) return <div className="loading">Loading…</div>

  return (
    <div>
      <header className="header">
        <h1>🎲 Media Picker</h1>
        <div className="header-actions">
          {igdbMsg && <span style={{ fontSize: 12, color: igdbMsg.startsWith('✓') ? 'var(--success)' : 'var(--danger)' }}>{igdbMsg}</span>}
          {updateMsg && <span style={{ fontSize: 12, color: updateMsg.startsWith('✓') ? 'var(--success)' : 'var(--danger)' }}>{updateMsg}</span>}
          <button className="btn-ghost" onClick={handleIGDB} disabled={igdbBusy} title="Fetch game cover art from IGDB (WebP)">
            {igdbBusy ? '…' : '🎮 Covers'}
          </button>
          <button className="btn-ghost" onClick={handleUpdate} disabled={updating} title="Refresh episode counts and airing dates from APIs">
            {updating ? '…' : '⟳ Update'}
          </button>
          <button className="btn-secondary" onClick={() => setSyncOpen(true)}>⟳ Sync</button>
          <button className="btn-ghost" onClick={() => setSettingsOpen(true)}>⚙ Settings</button>
        </div>
      </header>

      {/* Finish counter — always visible; shows ep/ch count for trackable categories */}
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

      {settingsOpen && <SettingsModal onClose={() => { setSettingsOpen(false); refresh() }} />}
      {syncOpen    && <SyncModal     onClose={() => { setSyncOpen(false);    refresh() }} />}
    </div>
  )
}
