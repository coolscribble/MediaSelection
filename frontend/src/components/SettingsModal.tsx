import { useState, useEffect } from 'react'
import { getSettings, saveSettings, getSimklPin, pollSimklPin, importPSN, importSteam, importXbox, getTmdbRequestToken, importTmdb } from '../api'
import {
  Settings, CATEGORIES, CATEGORY_LABELS, CATEGORY_ICONS,
  ANILIST_STATE_OPTIONS, SIMKL_STATE_OPTIONS,
  MAL_ANIME_STATE_OPTIONS, MAL_MANGA_STATE_OPTIONS,
} from '../types'

interface Props { onClose: () => void; username: string }

const DEFAULT_SETTINGS: Settings = {
  simkl_client_id: '', simkl_token_set: false,
  anilist_username: '', mal_username: '',
  anilist_states: ['PLANNING'], simkl_states: ['plantowatch'],
  mal_anime_states: ['plantowatch'], mal_manga_states: ['plantoread'],
  queue_modes: { movies: false, series: false, anime: false, manga: false, games: false, comics: false, albums: false },
  igdb_client_id: '', igdb_client_set: false,
  comicvine_api_set: false,
  save_covers_locally: false,
  public_profile: false,
  tmdb_api_key_set: false, tmdb_session_set: false,
  steam_id: '',
  xbox_key_set: false, xbox_gamertag: '',
}

export default function SettingsModal({ onClose, username }: Props) {
  const [tab, setTab] = useState<'connections' | 'states' | 'queue' | 'profile'>('connections')
  const [s, setS] = useState<Settings>(DEFAULT_SETTINGS)
  const [clientId, setClientId] = useState('')
  const [igdbClientId, setIgdbClientId] = useState('')
  const [igdbClientSecret, setIgdbClientSecret] = useState('')
  const [comicvineApiKey, setComicvineApiKey] = useState('')
  const [saveCoversLocally, setSaveCoversLocally] = useState(false)
  const [publicProfile, setPublicProfile] = useState(false)
  const [aniUser, setAniUser] = useState('')
  const [malUser, setMalUser] = useState('')
  const [aniStates, setAniStates] = useState<string[]>(['PLANNING'])
  const [simklStates, setSimklStates] = useState<string[]>(['plantowatch'])
  const [malAnimeStates, setMalAnimeStates] = useState<string[]>(['plantowatch'])
  const [malMangaStates, setMalMangaStates] = useState<string[]>(['plantoread'])
  const [queueModes, setQueueModes] = useState<Record<string, boolean>>({})
  const [pin, setPin] = useState<{ user_code: string; verification_url: string } | null>(null)
  const [polling, setPolling] = useState(false)
  const [msg, setMsg] = useState('')
  const [busy, setBusy] = useState(false)
  const [settingsLoaded, setSettingsLoaded] = useState(false)
  const [psnNpsso, setPsnNpsso] = useState('')
  const [psnSkipCompleted, setPsnSkipCompleted] = useState(false)
  const [psnPlatforms, setPsnPlatforms] = useState<string[]>(['PS4', 'PS5'])
  const [psnMsg, setPsnMsg] = useState('')
  const [psnBusy, setPsnBusy] = useState(false)
  const [steamId, setSteamId] = useState('')
  const [steamMsg, setSteamMsg] = useState('')
  const [steamBusy, setSteamBusy] = useState(false)
  const [xboxKey, setXboxKey] = useState('')
  const [xboxGamertag, setXboxGamertag] = useState('')
  const [xboxMsg, setXboxMsg] = useState('')
  const [xboxBusy, setXboxBusy] = useState(false)
  const [tmdbApiKey, setTmdbApiKey] = useState('')
  const [tmdbApproveUrl, setTmdbApproveUrl] = useState('')
  const [tmdbRequestToken, setTmdbRequestToken] = useState('')
  const [tmdbMsg, setTmdbMsg] = useState('')
  const [tmdbBusy, setTmdbBusy] = useState(false)

  useEffect(() => {
    getSettings()
      .then((data: Settings) => {
        setS(data)
        setClientId(data.simkl_client_id)
        setIgdbClientId(data.igdb_client_id ?? '')
        setAniUser(data.anilist_username)
        setMalUser(data.mal_username)
        setAniStates(data.anilist_states ?? ['PLANNING'])
        setSimklStates(data.simkl_states ?? ['plantowatch'])
        setMalAnimeStates(data.mal_anime_states ?? ['plantowatch'])
        setMalMangaStates(data.mal_manga_states ?? ['plantoread'])
        setQueueModes(data.queue_modes ?? {})
        setSaveCoversLocally(data.save_covers_locally ?? false)
        setPublicProfile(data.public_profile ?? false)
        setSteamId(data.steam_id ?? '')
        setXboxGamertag(data.xbox_gamertag ?? '')
      })
      .catch(() => setMsg('Failed to load settings — check your connection'))
      .finally(() => setSettingsLoaded(true))
  }, [])

  const toggleArr = (arr: string[], val: string) =>
    arr.includes(val) ? arr.filter(x => x !== val) : [...arr, val]

  const save = async () => {
    setBusy(true)
    try {
      await saveSettings({
        simkl_client_id: clientId,
        anilist_username: aniUser,
        mal_username: malUser,
        anilist_states: aniStates,
        simkl_states: simklStates,
        mal_anime_states: malAnimeStates,
        mal_manga_states: malMangaStates,
        queue_modes: queueModes,
        igdb_client_id: igdbClientId,
        ...(igdbClientSecret && { igdb_client_secret: igdbClientSecret }),
        ...(comicvineApiKey && { comicvine_api_key: comicvineApiKey }),
        save_covers_locally: saveCoversLocally,
        public_profile: publicProfile,
        ...(tmdbApiKey && { tmdb_api_key: tmdbApiKey }),
        steam_id: steamId,
        ...(xboxKey && { xbox_xbl_key: xboxKey }),
        xbox_gamertag: xboxGamertag,
      })
      setMsg('Saved')
      setS(prev => ({ ...prev, queue_modes: queueModes as Settings['queue_modes'] }))
    } catch { setMsg('Save failed') } finally { setBusy(false) }
  }

  const startPin = async () => {
    setBusy(true); setMsg('')
    try {
      await saveSettings({ simkl_client_id: clientId })
      const data = await getSimklPin() as { user_code: string; verification_url: string }
      setPin(data); setPolling(true); pollForToken(data.user_code)
    } catch (e: unknown) { setMsg(e instanceof Error ? e.message : 'Error') }
    finally { setBusy(false) }
  }

  const handlePsnImport = async () => {
    if (!psnNpsso.trim()) { setPsnMsg('Paste your NPSSO token first'); return }
    setPsnBusy(true); setPsnMsg('')
    try {
      const res = await importPSN(psnNpsso.trim(), psnSkipCompleted, psnPlatforms) as {
        added: number; skipped: number; already: number; total: number
      }
      setPsnMsg(`✓ Added ${res.added} game${res.added !== 1 ? 's' : ''} — ${res.already} already in library, ${res.skipped} skipped`)
      setPsnNpsso('')
    } catch (e: unknown) { setPsnMsg(e instanceof Error ? e.message : 'Import failed') }
    finally { setPsnBusy(false) }
  }

  const handleSteamImport = async () => {
    if (!steamId.trim()) { setSteamMsg('Enter your Steam ID or username first'); return }
    setSteamBusy(true); setSteamMsg('')
    try {
      const r = await importSteam(steamId.trim()) as { added: number; already: number; total: number }
      setSteamMsg(`✓ Added ${r.added} game${r.added !== 1 ? 's' : ''} — ${r.already} already in library (${r.total} total in Steam)`)
    } catch (e: unknown) { setSteamMsg(e instanceof Error ? e.message : 'Import failed') }
    finally { setSteamBusy(false) }
  }

  const handleXboxImport = async () => {
    if (!xboxGamertag.trim()) { setXboxMsg('Enter your Gamertag first'); return }
    setXboxBusy(true); setXboxMsg('')
    try {
      const r = await importXbox(xboxGamertag.trim()) as { added: number; already: number; total: number }
      setXboxMsg(`✓ Added ${r.added} game${r.added !== 1 ? 's' : ''} — ${r.already} already in library`)
    } catch (e: unknown) { setXboxMsg(e instanceof Error ? e.message : 'Import failed') }
    finally { setXboxBusy(false) }
  }

  const handleTmdbGetLink = async () => {
    setTmdbBusy(true); setTmdbMsg('')
    try {
      const r = await getTmdbRequestToken() as { requestToken: string; approveUrl: string }
      setTmdbRequestToken(r.requestToken)
      setTmdbApproveUrl(r.approveUrl)
      setTmdbMsg('Visit the link below, approve, then click Import.')
    } catch (e: unknown) { setTmdbMsg(e instanceof Error ? e.message : 'Error') }
    finally { setTmdbBusy(false) }
  }

  const handleTmdbImport = async (useToken?: string) => {
    setTmdbBusy(true); setTmdbMsg('')
    try {
      const r = await importTmdb(useToken) as { added: number; already: number; total: number }
      setTmdbMsg(`✓ Added ${r.added} movie${r.added !== 1 ? 's' : ''} — ${r.already} already in library`)
      setTmdbApproveUrl(''); setTmdbRequestToken('')
      setS(prev => ({ ...prev, tmdb_session_set: true }))
    } catch (e: unknown) { setTmdbMsg(e instanceof Error ? e.message : 'Import failed') }
    finally { setTmdbBusy(false) }
  }

  const pollForToken = (userCode: string) => {
    let tries = 0
    const iv = setInterval(async () => {
      tries++
      try {
        const res = await pollSimklPin(userCode) as { authorized: boolean }
        if (res.authorized) {
          clearInterval(iv); setPolling(false); setPin(null)
          setMsg('✓ Simkl authorized!')
          setS(prev => ({ ...prev, simkl_token_set: true }))
        }
      } catch {}
      if (tries > 60) { clearInterval(iv); setPolling(false); setMsg('PIN code expired') }
    }, 5000)
  }

  const StateCheckboxes = ({ opts, values, onChange }: {
    opts: { value: string; label: string }[]
    values: string[]
    onChange: (v: string[]) => void
  }) => (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
      {opts.map(opt => (
        <label key={opt.value} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
          <input
            type="checkbox"
            checked={values.includes(opt.value)}
            onChange={() => onChange(toggleArr(values, opt.value))}
          />
          {opt.label}
        </label>
      ))}
    </div>
  )

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal" onClick={e => e.stopPropagation()} style={{ maxWidth: 580 }}>
        <div className="modal-header">
          <span>⚙ Settings</span>
          <button className="btn-ghost" onClick={onClose}>✕</button>
        </div>
        <div className="modal-body">
          <div className="tabs">
            <button className={`tab${tab === 'connections' ? ' active' : ''}`} onClick={() => setTab('connections')}>Connections</button>
            <button className={`tab${tab === 'states' ? ' active' : ''}`} onClick={() => setTab('states')}>Sync States</button>
            <button className={`tab${tab === 'queue' ? ' active' : ''}`} onClick={() => setTab('queue')}>Queue Mode</button>
            <button className={`tab${tab === 'profile' ? ' active' : ''}`} onClick={() => setTab('profile')}>Profile</button>
          </div>

          {tab === 'connections' && (
            <>
              <div className="sync-section">
                <h3>⛩️ AniList (Anime + Manga)</h3>
                <div className="form-group">
                  <label>Username</label>
                  <input value={aniUser} onChange={e => setAniUser(e.target.value)} placeholder="your_username" />
                </div>
                <p style={{ fontSize: 12, color: 'var(--text2)' }}>Syncs from anilist.co — no password required.</p>
              </div>

              <div className="sync-section">
                <h3>🎌 MyAnimeList (Anime + Manga)</h3>
                <div className="form-group">
                  <label>Username</label>
                  <input value={malUser} onChange={e => setMalUser(e.target.value)} placeholder="your_mal_username" />
                </div>
                <p style={{ fontSize: 12, color: 'var(--text2)' }}>Uses Jikan — no API key needed. Profile must be public.</p>
              </div>

              <div className="sync-section">
                <h3>🎬 Simkl (Movies + Series + Anime)</h3>
                <div className="form-group">
                  <label>Client ID</label>
                  <input value={clientId} onChange={e => setClientId(e.target.value)} placeholder="from simkl.com/apps" />
                </div>
                <div className="sync-row">
                  <span className={`sync-status${s.simkl_token_set ? ' ok' : ''}`}>
                    {s.simkl_token_set ? '✓ Token saved' : '✗ Not authorized'}
                  </span>
                  <button className="btn-secondary" onClick={startPin} disabled={busy || polling || !clientId}>
                    {polling ? '⏳ Waiting…' : 'Authorize via PIN'}
                  </button>
                </div>
                {pin && (
                  <div className="pin-box">
                    <div className="pin-hint">Visit and enter this code:</div>
                    <a href={pin.verification_url} target="_blank" rel="noreferrer">{pin.verification_url}</a>
                    <div className="pin-code">{pin.user_code}</div>
                    <div className="pin-hint">App detects confirmation automatically…</div>
                  </div>
                )}
                <p style={{ fontSize: 12, color: 'var(--text2)', marginTop: 8 }}>
                  Get your Client ID at <strong>simkl.com/apps</strong> → New App (free).
                </p>
              </div>

              <div className="sync-section">
                <h3>🎬 Movies import</h3>
                <p style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 8 }}>
                  Import your movie watchlist from external trackers using the <strong>📥 Import CSV</strong> button in the Movies library.
                </p>
                <div style={{ fontSize: 12, color: 'var(--text2)', display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
                  <strong style={{ fontSize: 13 }}>Letterboxd</strong>
                  Go to <code>letterboxd.com/[username]/data/export/</code> → download ZIP → import <code>watchlist.csv</code>.
                </div>
                <div style={{ fontSize: 12, color: 'var(--text2)', display: 'flex', flexDirection: 'column', gap: 4, marginBottom: 12 }}>
                  <strong style={{ fontSize: 13 }}>Trakt</strong>
                  Go to <code>trakt.tv/settings</code> → Export Data → import <code>watchlist-movies.csv</code> (or <code>watchlist-shows.csv</code> for the Series library).
                </div>
                <div style={{ fontSize: 12, color: 'var(--text2)', display: 'flex', flexDirection: 'column', gap: 4 }}>
                  <strong style={{ fontSize: 13 }}>Serializd / iCheckMovies / Filmow</strong>
                  Export a CSV from the site and import via the library button — any CSV with a Title or Name column works.
                </div>
              </div>

              <div className="sync-section">
                <h3>🎬 TMDB Watchlist</h3>
                <div className="form-group">
                  <label>API Key (v3)</label>
                  <input
                    type="password"
                    value={tmdbApiKey}
                    onChange={e => setTmdbApiKey(e.target.value)}
                    placeholder={s.tmdb_api_key_set ? '••••••••• (saved)' : 'from themoviedb.org/settings/api'}
                  />
                </div>
                <p style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 10 }}>
                  Get a free v3 API key at <strong>themoviedb.org/settings/api</strong>. Hit <strong>Save</strong> first, then authorize.
                </p>
                {tmdbApproveUrl && (
                  <div className="pin-box">
                    <div className="pin-hint">Open this link in your browser and approve:</div>
                    <a href={tmdbApproveUrl} target="_blank" rel="noreferrer">{tmdbApproveUrl}</a>
                    <div className="pin-hint">Then click Import below.</div>
                  </div>
                )}
                <div className="sync-row">
                  {tmdbMsg && <span className={`sync-status${tmdbMsg.startsWith('✓') ? ' ok' : ''}`}>{tmdbMsg}</span>}
                  <div style={{ display: 'flex', gap: 8 }}>
                    <button className="btn-secondary" onClick={handleTmdbGetLink} disabled={tmdbBusy || !s.tmdb_api_key_set}>
                      {tmdbBusy && !tmdbApproveUrl ? '⏳…' : 'Get auth link'}
                    </button>
                    {tmdbApproveUrl && (
                      <button className="btn-secondary" onClick={() => handleTmdbImport(tmdbRequestToken)} disabled={tmdbBusy}>
                        {tmdbBusy ? '⏳ Importing…' : 'Import after approving'}
                      </button>
                    )}
                    {s.tmdb_session_set && !tmdbApproveUrl && (
                      <button className="btn-secondary" onClick={() => handleTmdbImport()} disabled={tmdbBusy}>
                        {tmdbBusy ? '⏳ Importing…' : 'Re-import watchlist'}
                      </button>
                    )}
                  </div>
                </div>
                <div className="sync-row" style={{ marginTop: 4 }}>
                  <span className={`sync-status${s.tmdb_session_set ? ' ok' : ''}`}>
                    {s.tmdb_session_set ? '✓ Authorized' : '✗ Not authorized'}
                  </span>
                </div>
              </div>

              <div className="sync-section">
                <h3>💬 Comics cover art</h3>
                <p style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 8 }}>
                  Uses the Google Books API — no API key needed.
                  Import your comics via CSV, then click <strong>💬 Covers</strong> in the header to fetch artwork automatically.
                </p>
                <h4 style={{ margin: '12px 0 6px', fontSize: 13 }}>ComicVine (better matching)</h4>
                <div className="form-group">
                  <label>API Key</label>
                  <input
                    type="password"
                    value={comicvineApiKey}
                    onChange={e => setComicvineApiKey(e.target.value)}
                    placeholder={s.comicvine_api_set ? '••••••••• (saved)' : 'paste key from comicvine.gamespot.com/api'}
                  />
                </div>
                <div className="sync-row">
                  <span className={`sync-status${s.comicvine_api_set ? ' ok' : ''}`}>
                    {s.comicvine_api_set ? '✓ Key saved' : '✗ Not configured'}
                  </span>
                </div>
                <p style={{ fontSize: 12, color: 'var(--text2)', marginTop: 8 }}>
                  Get a free API key at <strong>comicvine.gamespot.com/api</strong>. Used for the 🎨 ComicVine Sync button in the library.
                </p>
              </div>

              <div className="sync-section">
                <h3>🎵 Albums cover art</h3>
                <p style={{ fontSize: 12, color: 'var(--text2)' }}>
                  Uses the iTunes Search API — no API key needed.
                  Import your albums via CSV, then click <strong>🎵 Covers</strong> in the header to fetch artwork automatically.
                </p>
              </div>

              <div className="sync-section">
                <h3>🎮 IGDB (Games metadata + covers)</h3>
                <div className="form-group">
                  <label>Client ID</label>
                  <input value={igdbClientId} onChange={e => setIgdbClientId(e.target.value)} placeholder="from dev.twitch.tv" />
                </div>
                <div className="form-group">
                  <label>Client Secret</label>
                  <input
                    type="password"
                    value={igdbClientSecret}
                    onChange={e => setIgdbClientSecret(e.target.value)}
                    placeholder={s.igdb_client_set ? '••••••••• (saved)' : 'paste secret here'}
                  />
                </div>
                <div className="sync-row">
                  <span className={`sync-status${s.igdb_client_set ? ' ok' : ''}`}>
                    {s.igdb_client_set ? '✓ Secret saved' : '✗ Not configured'}
                  </span>
                </div>
                <p style={{ fontSize: 12, color: 'var(--text2)', marginTop: 8 }}>
                  Register a free app at <strong>dev.twitch.tv/console</strong> to get credentials.
                  Hit <strong>Save</strong> then <strong>⟳ Update</strong> to fetch covers and ratings for all games.
                </p>
              </div>

              <div className="sync-section">
                <h3>🎮 Steam import</h3>
                <div className="form-group">
                  <label>Steam username or profile URL</label>
                  <input
                    value={steamId}
                    onChange={e => setSteamId(e.target.value)}
                    placeholder="e.g. lilcipra or steamcommunity.com/id/lilcipra"
                  />
                </div>
                <p style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 10 }}>
                  No API key needed. Your Steam profile <strong>Game Details</strong> must be set to <strong>Public</strong> in Steam → Privacy Settings.
                  Hit <strong>Save</strong> to store the username, then import.
                </p>
                <div className="sync-row">
                  {steamMsg && <span className={`sync-status${steamMsg.startsWith('✓') ? ' ok' : ''}`}>{steamMsg}</span>}
                  <button
                    className="btn-secondary"
                    onClick={handleSteamImport}
                    disabled={steamBusy || !steamId.trim()}
                  >
                    {steamBusy ? '⏳ Importing…' : 'Import Steam library'}
                  </button>
                </div>
              </div>

              <div className="sync-section">
                <h3>🎮 Xbox import</h3>
                <div className="form-group">
                  <label>xbl.io API Key</label>
                  <input
                    type="password"
                    value={xboxKey}
                    onChange={e => setXboxKey(e.target.value)}
                    placeholder={s.xbox_key_set ? '••••••••• (saved)' : 'free key from xbl.io'}
                  />
                </div>
                <div className="form-group">
                  <label>Gamertag</label>
                  <input
                    value={xboxGamertag}
                    onChange={e => setXboxGamertag(e.target.value)}
                    placeholder="your Xbox Gamertag"
                  />
                </div>
                <p style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 10 }}>
                  Get a free API key at <strong>xbl.io</strong> (unofficial Xbox Live API — 500 req/day free tier).
                  Hit <strong>Save</strong> first, then import.
                </p>
                <div className="sync-row">
                  {xboxMsg && <span className={`sync-status${xboxMsg.startsWith('✓') ? ' ok' : ''}`}>{xboxMsg}</span>}
                  <button
                    className="btn-secondary"
                    onClick={handleXboxImport}
                    disabled={xboxBusy || !s.xbox_key_set || !xboxGamertag.trim()}
                  >
                    {xboxBusy ? '⏳ Importing…' : 'Import Xbox library'}
                  </button>
                </div>
                <p style={{ fontSize: 12, color: 'var(--text2)', marginTop: 8 }}>
                  GOG and Nintendo Switch do not have public APIs — use the <strong>📥 Import CSV</strong> button in the Games library with a CSV export instead.
                </p>
              </div>

              <div className="sync-section">
                <h3>🎮 PlayStation Network (PSN) import</h3>
                <p style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 10 }}>
                  Imports your trophy-tracked games from PSN into the Games library. Requires a one-time NPSSO token
                  from your PlayStation session — it is used immediately and never stored.
                </p>
                <p style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 10 }}>
                  <strong>How to get your NPSSO:</strong> Log in at <code>playstation.com</code>,
                  then open a new tab and go to&nbsp;
                  <code>ca.account.sony.com/api/v1/ssocookie</code>.
                  Copy the <code>npsso</code> value from the JSON response.
                </p>
                <div className="form-group">
                  <label>NPSSO token</label>
                  <input
                    type="password"
                    value={psnNpsso}
                    onChange={e => setPsnNpsso(e.target.value)}
                    placeholder="64-character token from PlayStation"
                  />
                </div>
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 10 }}>
                  <label style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>Platforms to include</label>
                  {['PS5', 'PS4', 'PS3', 'PSVITA'].map(p => (
                    <label key={p} style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13 }}>
                      <input
                        type="checkbox"
                        checked={psnPlatforms.includes(p)}
                        onChange={() => setPsnPlatforms(prev =>
                          prev.includes(p) ? prev.filter(x => x !== p) : [...prev, p]
                        )}
                      />
                      {p}
                    </label>
                  ))}
                </div>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: 13, marginBottom: 10 }}>
                  <input
                    type="checkbox"
                    checked={psnSkipCompleted}
                    onChange={e => setPsnSkipCompleted(e.target.checked)}
                  />
                  Skip games with 100% trophies (already completed)
                </label>
                <div className="sync-row">
                  {psnMsg && <span className={`sync-status${psnMsg.startsWith('✓') ? ' ok' : ''}`}>{psnMsg}</span>}
                  <button
                    className="btn-secondary"
                    onClick={handlePsnImport}
                    disabled={psnBusy || !psnNpsso.trim() || psnPlatforms.length === 0}
                  >
                    {psnBusy ? '⏳ Importing…' : 'Import PSN library'}
                  </button>
                </div>
              </div>

              <div className="sync-section">
                <h3>💾 Local image cache</h3>
                <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={saveCoversLocally}
                    onChange={e => setSaveCoversLocally(e.target.checked)}
                  />
                  Save cover images to disk
                </label>
                <p style={{ fontSize: 12, color: 'var(--text2)', marginTop: 8 }}>
                  When enabled, cover art is downloaded to <code>/data/covers/</code> inside the container
                  and served locally. Covers survive if external image hosts go offline.
                  Takes effect on the next sync or cover fetch.
                </p>
              </div>
            </>
          )}

          {tab === 'states' && (
            <>
              <div className="sync-section">
                <h3>⛩️ AniList — which lists to import</h3>
                <StateCheckboxes opts={ANILIST_STATE_OPTIONS} values={aniStates} onChange={setAniStates} />
              </div>
              <div className="sync-section">
                <h3>🎬 Simkl — which lists to import</h3>
                <p style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 10 }}>Applies to Movies, Series and Anime.</p>
                <StateCheckboxes opts={SIMKL_STATE_OPTIONS} values={simklStates} onChange={setSimklStates} />
              </div>
              <div className="sync-section">
                <h3>🎌 MAL — Anime lists to import</h3>
                <StateCheckboxes opts={MAL_ANIME_STATE_OPTIONS} values={malAnimeStates} onChange={setMalAnimeStates} />
              </div>
              <div className="sync-section">
                <h3>🎌 MAL — Manga lists to import</h3>
                <StateCheckboxes opts={MAL_MANGA_STATE_OPTIONS} values={malMangaStates} onChange={setMalMangaStates} />
              </div>
            </>
          )}

          {tab === 'queue' && (
            <div className="sync-section">
              <h3>Queue Mode per category</h3>
              <p style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 14 }}>
                When enabled, completing a slot automatically pulls the next item from that category's queue
                instead of leaving it empty. Use the 📋 Queue button to manage the ordered list.
              </p>
              {CATEGORIES.map(cat => (
                <label key={cat} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 0', borderBottom: '1px solid var(--border)', cursor: 'pointer', fontSize: 13 }}>
                  <input
                    type="checkbox"
                    checked={Boolean(queueModes[cat])}
                    onChange={e => setQueueModes(prev => ({ ...prev, [cat]: e.target.checked }))}
                  />
                  <span>{CATEGORY_ICONS[cat]} {CATEGORY_LABELS[cat]}</span>
                </label>
              ))}
            </div>
          )}

          {tab === 'profile' && (
            <div className="sync-section">
              <h3>🌐 Public profile</h3>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={publicProfile}
                  onChange={e => setPublicProfile(e.target.checked)}
                />
                Make my profile public
              </label>
              <p style={{ fontSize: 12, color: 'var(--text2)', marginTop: 8 }}>
                When enabled, anyone can view your current picks and library counts at the link below.
                They cannot edit anything — it's read only.
              </p>
              {publicProfile && (() => {
                const profileUrl = `${window.location.origin}/user/${username}`
                return (
                  <div style={{ marginTop: 12 }}>
                    <div style={{ fontSize: 12, color: 'var(--text2)', marginBottom: 6 }}>Your public profile link:</div>
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                      <code style={{ flex: 1, background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 6, padding: '6px 10px', fontSize: 12, wordBreak: 'break-all' }}>
                        {profileUrl}
                      </code>
                      <button
                        className="btn-secondary"
                        style={{ whiteSpace: 'nowrap' }}
                        onClick={() => navigator.clipboard.writeText(profileUrl).then(() => setMsg('Link copied!'))}
                      >
                        Copy
                      </button>
                    </div>
                  </div>
                )
              })()}
              <p style={{ fontSize: 12, color: 'var(--text2)', marginTop: 12 }}>
                Remember to hit <strong>Save</strong> to apply the change.
              </p>
            </div>
          )}

          {msg && <div className={msg.startsWith('✓') || msg === 'Saved' ? 'success-msg' : 'error-msg'} style={{ marginTop: 12 }}>{msg}</div>}
        </div>
        <div className="modal-footer">
          <button className="btn-ghost" onClick={onClose}>Close</button>
          <button className="btn-primary" onClick={save} disabled={busy || !settingsLoaded}>
            {settingsLoaded ? 'Save' : 'Loading…'}
          </button>
        </div>
      </div>
    </div>
  )
}
