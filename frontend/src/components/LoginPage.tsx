import { useState } from 'react'
import { login, loginLocal } from '../api'
import { User } from '../types'

interface Props {
  onLogin: (token: string, user: User) => void
}

export default function LoginPage({ onLogin }: Props) {
  const [serverUrl, setServerUrl] = useState('')
  const [username, setUsername] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!serverUrl.trim() || !username.trim() || !password.trim()) {
      setError('All fields are required')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const data = await login(serverUrl.trim(), username.trim(), password)
      onLogin(data.token, { username: data.username, server_url: serverUrl.trim() })
    } catch (e: unknown) {
      setError(e instanceof Error ? e.message : 'Login failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div style={{
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      minHeight: '100vh',
      background: 'var(--bg)',
    }}>
      <form
        onSubmit={handleSubmit}
        style={{
          background: 'var(--surface)',
          border: '1px solid var(--border)',
          borderRadius: 12,
          padding: '36px 32px',
          width: 360,
          display: 'flex',
          flexDirection: 'column',
          gap: 16,
        }}
      >
        <h2 style={{ margin: 0, textAlign: 'center', fontSize: 22 }}>🎲 Media Picker</h2>
        <p style={{ margin: 0, textAlign: 'center', color: 'var(--text2)', fontSize: 13 }}>
          Sign in with your Jellyfin account
        </p>

        <div className="form-group">
          <label>Jellyfin server URL</label>
          <input
            type="url"
            value={serverUrl}
            onChange={e => setServerUrl(e.target.value)}
            placeholder="https://jellyfin.example.com"
            autoComplete="url"
            required
          />
        </div>

        <div className="form-group">
          <label>Username</label>
          <input
            type="text"
            value={username}
            onChange={e => setUsername(e.target.value)}
            placeholder="your Jellyfin username"
            autoComplete="username"
            required
          />
        </div>

        <div className="form-group">
          <label>Password</label>
          <input
            type="password"
            value={password}
            onChange={e => setPassword(e.target.value)}
            placeholder="your Jellyfin password"
            autoComplete="current-password"
            required
          />
        </div>

        {error && (
          <p style={{ margin: 0, color: 'var(--error, #e55)', fontSize: 13, textAlign: 'center' }}>
            {error}
          </p>
        )}

        <button
          type="submit"
          className="btn-primary"
          disabled={busy}
          style={{ marginTop: 4 }}
        >
          {busy ? 'Signing in…' : 'Sign in with Jellyfin'}
        </button>

        <div style={{ display: 'flex', alignItems: 'center', gap: 8, margin: '4px 0' }}>
          <hr style={{ flex: 1, border: 'none', borderTop: '1px solid var(--border)' }} />
          <span style={{ color: 'var(--text2)', fontSize: 12 }}>or</span>
          <hr style={{ flex: 1, border: 'none', borderTop: '1px solid var(--border)' }} />
        </div>

        <button
          type="button"
          className="btn-ghost"
          disabled={busy}
          style={{ width: '100%' }}
          onClick={async () => {
            setBusy(true)
            setError(null)
            try {
              const data = await loginLocal()
              onLogin(data.token, { username: data.username, server_url: '' })
            } catch (e: unknown) {
              setError(e instanceof Error ? e.message : 'Login failed')
            } finally {
              setBusy(false)
            }
          }}
        >
          Continue without Jellyfin
        </button>

        <p style={{ margin: 0, textAlign: 'center', color: 'var(--text2)', fontSize: 11 }}>
          Your data is saved locally under a shared "local" account
        </p>
      </form>
    </div>
  )
}
