import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useNavigate } from 'react-router-dom'
import { doc, setDoc } from 'firebase/firestore'
import { signOut } from 'firebase/auth'
import { LogOut } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { auth, firestore } from '../firebase'
import { api } from '../lib/api'

const colors = ['blue', 'purple', 'orange', 'emerald', 'rose', 'indigo']

export function Settings() {
  const { i18n } = useTranslation()
  const navigate = useNavigate()
  const qc = useQueryClient()
  const [color, setColor] = useState(localStorage.getItem('tt-color') || 'blue')
  const [loggingOut, setLoggingOut] = useState(false)

  const providers = useQuery({
    queryKey: ['providers'],
    queryFn: () => api<any[]>('/api/market/providers'),
    retry: false,
  })

  async function preference(field: string, value: string) {
    if (!auth.currentUser) return
    await setDoc(doc(firestore, 'preferences', auth.currentUser.uid), { [field]: value }, { merge: true })
    await setDoc(doc(firestore, 'profiles', auth.currentUser.uid), { [field]: value }, { merge: true })
  }

  async function language(value: string) {
    localStorage.setItem('tt-lang', value)
    await i18n.changeLanguage(value)
    await preference('preferredLanguage', value)
  }

  async function theme(value: string) {
    setColor(value)
    localStorage.setItem('tt-color', value)
    document.documentElement.dataset.theme = value
    await preference('themeColor', value)
  }

  async function handleLogout() {
    if (loggingOut) return
    setLoggingOut(true)

    try {
      qc.clear()
      await signOut(auth)
      sessionStorage.clear()
      navigate('/login', { replace: true })
    } catch (error) {
      console.error('Logout failed:', error)
      setLoggingOut(false)
      alert('Could not sign out. Please try again.')
    }
  }

  const reset = useMutation({
    mutationFn: () => api('/api/account/reset', { method: 'POST' }),
    onSuccess: () => qc.invalidateQueries(),
  })

  return (
    <>
      <header className="pageHead">
        <div>
          <span className="eyebrow">Personalize the simulator</span>
          <h1>Settings</h1>
        </div>
      </header>

      <div className="settingsGrid">
        <section className="panel">
          <h2>Language</h2>
          <div className="buttonGroup">
            {[
              ['pt', '🇧🇷 Português'],
              ['en', '🇺🇸 English'],
              ['es', '🇪🇸 Español'],
            ].map(([value, label]) => (
              <button type="button" onClick={() => language(value)} key={value}>
                {label}
              </button>
            ))}
          </div>
        </section>

        <section className="panel">
          <h2>Theme color</h2>
          <div className="themeDots">
            {colors.map((value) => (
              <button
                type="button"
                aria-label={value}
                className={`${value} ${color === value ? 'selected' : ''}`}
                onClick={() => theme(value)}
                key={value}
              />
            ))}
          </div>
        </section>

        <section className="panel">
          <h2>Provider Status</h2>
          <div style={{ marginTop: 12 }}>
            {providers.data?.map((provider) => (
              <div className="row" key={provider.name}>
                <strong>{provider.name}</strong>
                <span className={provider.configured ? 'positive' : 'negative'}>
                  {provider.configured ? 'configured' : 'not configured'}
                </span>
              </div>
            ))}
            {providers.error && <p className="negative">Render API not connected</p>}
          </div>
        </section>

        <section className="panel dangerZone">
          <h2>Reset Virtual Account</h2>
          <p>
            Returns the virtual balance to $10,000 and removes open simulated positions. This can't be used to
            withdraw or create real money.
          </p>
          <button
            type="button"
            className="ghostDanger"
            onClick={() => {
              if (confirm('Reset your virtual account to $10,000?')) reset.mutate()
            }}
          >
            Reset virtual account
          </button>
        </section>

        <section className="panel">
          <h2>Account session</h2>
          <p className="settingsMuted">
            Signed in{auth.currentUser?.email ? ` as ${auth.currentUser.email}` : ''}. Sign out safely on this device.
          </p>
          <button
            type="button"
            className="logoutButton"
            onClick={handleLogout}
            disabled={loggingOut}
          >
            <LogOut size={18} />
            {loggingOut ? 'Signing out…' : 'Sign out'}
          </button>
        </section>

        <section className="panel">
          <h2>Open Source</h2>
          <p>
            React, Firebase, TanStack Query, Lightweight Charts, i18next, Lucide, Decimal.js, Tailwind CSS, Vite PWA
            and other packages are listed in package.json with their upstream licenses.
          </p>
        </section>
      </div>
    </>
  )
}
