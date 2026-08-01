import { useState, useEffect } from 'react'
import { ComposableMap, Geographies, Geography } from 'react-simple-maps'
import { getWorldMap, syncSimkl } from '../api'
import { ISO_NUMERIC_TO_A2, COUNTRY_NAMES } from './countryData'

interface CountryData {
  count: number
  titles: string[]
}

interface Props {
  onBack: () => void
}

const GEO_URL      = '/world-110m.json'
const WATCHED      = '#27ae60'
const UNWATCHED    = '#2a2d31'
const WATCHED_HOV  = '#2ecc71'
const UNWATCHED_HOV= '#3d4147'
const STROKE       = '#1a1d20'
const BASE_SCALE   = 147

export default function WorldMapPage({ onBack }: Props) {
  const [countries,    setCountries]   = useState<Record<string, CountryData>>({})
  const [mapLoading,   setMapLoading]  = useState(true)
  const [syncing,      setSyncing]     = useState(false)
  const [error,        setError]       = useState('')
  const [msg,          setMsg]         = useState('')
  const [hoveredCode,  setHoveredCode] = useState<string | null>(null)
  const [tooltip,      setTooltip]     = useState<{ name: string; count: number; titles: string[]; x: number; y: number } | null>(null)
  const [mapScale,     setMapScale]    = useState(BASE_SCALE)

  const loadMap = (fresh = false) => {
    setMapLoading(true)
    setError('')
    getWorldMap(fresh)
      .then((d: { countries: Record<string, CountryData> }) => {
        setCountries(d.countries)
        setMapLoading(false)
      })
      .catch((e: Error) => {
        setError(e.message)
        setMapLoading(false)
      })
  }

  useEffect(() => { loadMap() }, [])

  const handleSyncSimkl = async () => {
    setSyncing(true)
    setMsg('')
    setError('')
    try {
      await syncSimkl()
      setMsg('Simkl synced — refreshing map…')
      loadMap(true)
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Sync failed')
    } finally {
      setSyncing(false)
    }
  }

  const watchedCodes  = new Set(Object.keys(countries))
  const watchedCount  = watchedCodes.size
  const sortedList    = Object.entries(countries).sort(([, a], [, b]) => b.count - a.count)

  return (
    <div className="world-map-page">

      {/* Header */}
      <div className="world-map-header">
        <button className="btn-secondary" onClick={onBack} style={{ flexShrink: 0 }}>← Back</button>
        <h2 className="world-map-title">🌍 Country Map</h2>
        {!mapLoading && !error && (
          <span className="world-map-stat">{watchedCount} countries watched</span>
        )}
        <div style={{ flex: 1 }} />
        <button
          className="btn-secondary"
          onClick={handleSyncSimkl}
          disabled={syncing || mapLoading}
          title="Sync Simkl watchlist then refresh map"
        >
          {syncing ? '…' : '⟳ Sync from Simkl'}
        </button>
        <div className="world-map-zoom-btns">
          <button className="btn-ghost btn-icon" title="Zoom in"  onClick={() => setMapScale(s => Math.min(s * 1.5, 900))}>+</button>
          <button className="btn-ghost btn-icon" title="Reset"    onClick={() => setMapScale(BASE_SCALE)}>⊙</button>
          <button className="btn-ghost btn-icon" title="Zoom out" onClick={() => setMapScale(s => Math.max(s / 1.5, 60))}>−</button>
        </div>
      </div>

      {msg && <div className="world-map-msg">{msg}</div>}

      {/* Map */}
      <div className="world-map-container">
        {mapLoading && <div className="world-map-loading">Loading Simkl data…</div>}
        {!mapLoading && error && <div className="world-map-error">{error}</div>}
        {!mapLoading && !error && watchedCount === 0 && (
          <div className="world-map-empty">
            No country data found. Make sure Simkl is connected and you have completed/watching items, then press "Sync from Simkl".
          </div>
        )}
        {!mapLoading && !error && (
          <>
            <ComposableMap
              projectionConfig={{ rotate: [-10, 0, 0], scale: mapScale }}
              style={{ width: '100%', height: '100%', display: 'block' }}
            >
              <Geographies geography={GEO_URL}>
                {({ geographies }: { geographies: Array<{ rsmKey: string; id: string }> }) =>
                  geographies.map((geo: { rsmKey: string; id: string }) => {
                    const a2      = ISO_NUMERIC_TO_A2[String(geo.id)]
                    const watched = a2 ? watchedCodes.has(a2) : false
                    const hovered = a2 === hoveredCode
                    const fill    = watched
                      ? (hovered ? WATCHED_HOV   : WATCHED)
                      : (hovered ? UNWATCHED_HOV : UNWATCHED)

                    return (
                      <Geography
                        key={geo.rsmKey}
                        geography={geo}
                        fill={fill}
                        stroke={STROKE}
                        strokeWidth={0.4}
                        style={{ default: { outline: 'none' }, hover: { outline: 'none' }, pressed: { outline: 'none' } }}
                        onMouseEnter={(e: React.MouseEvent) => {
                          if (!a2) return
                          setHoveredCode(a2)
                          const data = countries[a2]
                          setTooltip({ name: COUNTRY_NAMES[a2] || a2, count: data?.count ?? 0, titles: data?.titles ?? [], x: e.clientX, y: e.clientY })
                        }}
                        onMouseMove={(e: React.MouseEvent) => {
                          setTooltip(t => t ? { ...t, x: e.clientX, y: e.clientY } : null)
                        }}
                        onMouseLeave={() => { setHoveredCode(null); setTooltip(null) }}
                      />
                    )
                  })
                }
              </Geographies>
            </ComposableMap>

            <div className="world-map-legend">
              <span className="world-map-legend-item"><i style={{ background: WATCHED }} /> Watched ({watchedCount})</span>
              <span className="world-map-legend-item"><i style={{ background: UNWATCHED, border: '1px solid #444' }} /> Not yet</span>
            </div>
          </>
        )}
      </div>

      {/* Tooltip — pointer-events:none so it never blocks clicks */}
      {tooltip && (
        <div className="world-map-tooltip" style={{ left: tooltip.x + 14, top: tooltip.y - 10 }}>
          <strong>{tooltip.name}</strong>
          {tooltip.count > 0 ? (
            <>
              <div style={{ fontSize: 11, color: 'var(--success)', margin: '2px 0' }}>{tooltip.count} title{tooltip.count !== 1 ? 's' : ''}</div>
              {tooltip.titles.slice(0, 3).map(t => (
                <div key={t} style={{ fontSize: 11, opacity: 0.7, whiteSpace: 'nowrap', maxWidth: 200, overflow: 'hidden', textOverflow: 'ellipsis' }}>{t}</div>
              ))}
            </>
          ) : (
            <div style={{ fontSize: 11, opacity: 0.5, marginTop: 2 }}>Nothing watched yet</div>
          )}
        </div>
      )}

      {/* Country list */}
      {!mapLoading && !error && sortedList.length > 0 && (
        <div className="world-map-list-section">
          <h3 className="world-map-list-title">Watched Countries ({watchedCount})</h3>
          <div className="world-map-list">
            {sortedList.map(([code, data]) => (
              <div
                key={code}
                className={`world-map-country-card${hoveredCode === code ? ' hovered' : ''}`}
                onMouseEnter={() => setHoveredCode(code)}
                onMouseLeave={() => setHoveredCode(null)}
              >
                <span className="world-map-country-name">{COUNTRY_NAMES[code] || code}</span>
                <span className="world-map-country-count">{data.count} title{data.count !== 1 ? 's' : ''}</span>
              </div>
            ))}
          </div>
        </div>
      )}

    </div>
  )
}
