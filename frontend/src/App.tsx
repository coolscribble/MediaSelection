import { useState, useEffect, useCallback } from 'react'
import { CATEGORIES, CATEGORY_LABELS, CATEGORY_ICONS, SlotsData, Settings } from './types'
import { getSlots, getSettings, getStats, updateMetadata } from './api'
import CategorySection from './components/CategorySection'
import SettingsModal from './components/SettingsModal'
import SyncModal from './components/SyncModal'
import OngoingSection from './components/OngoingSection'

export default function App() {
  const [slots, setSlots] = useState<SlotsData | null>(null)
  const [settings, setSettings] = useState<Settings | null>(null)
  const [stats, setStats] = useState<Record<string, number>>({})
  const [loading, setLoading] = useState(true)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [syncOpen, setSyncOpen] = useState(false)
  const [updating, setUpdating] = useState(false)
  const [updateMsg, setUpdateMsg] = useState('')

  const refresh = useCallback(async () => {
    try {
      const [s, cfg, st] = await Promise.all([getSlots(), getSettings(), getStats()])
      setSlots(s)
      setSettings(cfg)
      setStats(st as Record<string, number>)
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

  const statEntries = CATEGORIES.filter(c => (stats[c] ?? 0) > 0)

  if (loading) return <div className="loading">Loading…</div>

  return (
    <div>
      <header className="header">
        <h1>🎲 Media Picker</h1>
        <div className="header-actions">
          {updateMsg && <span style={{ fontSize: 12, color: updateMsg.startsWith('✓') ? 'var(--success)' : 'var(--danger)' }}>{updateMsg}</span>}
          <button className="btn-ghost" onClick={handleUpdate} disabled={updating} title="Refresh episode counts and airing dates from APIs">
            {updating ? '…' : '⟳ Update'}
          </button>
          <button className="btn-secondary" onClick={() => setSyncOpen(true)}>⟳ Sync</button>
          <button className="btn-ghost" onClick={() => setSettingsOpen(true)}>⚙ Settings</button>
        </div>
      </header>

      {statEntries.length > 0 && (
        <div className="stats-bar">
          <span className="stats-label">Cleared from backlog:</span>
          {statEntries.map(c => (
            <span key={c} className="stats-item">
              {CATEGORY_ICONS[c]} {stats[c]} {CATEGORY_LABELS[c]}
            </span>
          ))}
        </div>
      )}

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
