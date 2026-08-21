import { NavLink, Outlet, useNavigate } from 'react-router-dom'
import {
  Home, LineChart, Repeat2, WalletCards, Menu, X, GraduationCap, Trophy,
  BrainCircuit, History, Settings, LogOut, FlaskConical,
} from 'lucide-react'
import { signOut } from 'firebase/auth'
import { auth, firestore } from '../firebase'
import { Logo } from './Logo'
import { useTranslation } from 'react-i18next'
import { useEffect, useState } from 'react'
import { doc, getDoc } from 'firebase/firestore'
import { useQueryClient } from '@tanstack/react-query'

const items = [
  ['/dashboard', Home, 'home'],
  ['/markets', LineChart, 'markets'],
  ['/markets', Repeat2, 'trade'],
  ['/portfolio', WalletCards, 'portfolio'],
  ['/intelligence', FlaskConical, 'intelligence'],
  ['/learn', GraduationCap, 'learn'],
  ['/leaderboard', Trophy, 'leaderboard'],
  ['/ai-coach', BrainCircuit, 'coach'],
  ['/history', History, 'history'],
  ['/settings', Settings, 'settings'],
] as const

const mobilePrimaryItems = items.slice(0, 4)
const mobileMoreItems = items

export function Layout() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [mobileMenuOpen, setMobileMenuOpen] = useState(false)

  useEffect(() => {
    const user = auth.currentUser
    if (!user) return

    getDoc(doc(firestore, 'preferences', user.uid))
      .then((snapshot) => {
        const data = snapshot.data()
        if (data?.themeColor) {
          document.documentElement.dataset.theme = data.themeColor
          localStorage.setItem('tt-color', data.themeColor)
        }
        if (data?.preferredLanguage) {
          void i18n.changeLanguage(data.preferredLanguage)
          localStorage.setItem('tt-lang', data.preferredLanguage)
        }
      })
      .catch((error) => console.error('Could not load preferences:', error))
  }, [i18n])

  useEffect(() => {
    if (!mobileMenuOpen) {
      document.body.style.overflow = ''
      return
    }
    document.body.style.overflow = 'hidden'
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setMobileMenuOpen(false)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => {
      document.body.style.overflow = ''
      window.removeEventListener('keydown', onKeyDown)
    }
  }, [mobileMenuOpen])

  async function handleLogout() {
    try {
      setMobileMenuOpen(false)
      queryClient.clear()
      await signOut(auth)
      sessionStorage.clear()
      navigate('/login', { replace: true })
    } catch (error) {
      console.error('Logout failed:', error)
    }
  }

  return (
    <div className="shell">
      <aside>
        <Logo />
        <nav>
          {items.map(([to, Icon, key]) => (
            <NavLink key={`${to}-${key}`} to={to}>
              <Icon size={19} />
              <span>{t(key)}</span>
            </NavLink>
          ))}
        </nav>
        <button type="button" className="sideLogout" onClick={handleLogout}>
          <LogOut size={18} />
          {t('signOut')}
        </button>
      </aside>

      <main>
        <header className="mobileTopBar">
          <Logo />
          <button
            type="button"
            className="mobileMenuButton"
            aria-label="Open menu"
            aria-expanded={mobileMenuOpen}
            onClick={() => setMobileMenuOpen(true)}
          >
            <Menu size={24} />
          </button>
        </header>

        <div className="simBar">
          <strong>{t('simulator')}</strong>
          <span>{t('disclaimerShort')}</span>
        </div>

        <div className="page">
          <Outlet />
        </div>
      </main>

      <nav className="bottomNav" aria-label="Primary mobile navigation">
        {mobilePrimaryItems.map(([to, Icon, key]) => (
          <NavLink key={`${to}-${key}`} to={to}>
            <Icon size={21} />
            <small>{t(key)}</small>
          </NavLink>
        ))}
      </nav>

      {mobileMenuOpen && (
        <div className="mobileMenuLayer" onClick={() => setMobileMenuOpen(false)}>
          <section
            className="mobileDrawer"
            role="dialog"
            aria-modal="true"
            aria-label="Navigation menu"
            onClick={(event) => event.stopPropagation()}
          >
            <div className="mobileDrawerHead">
              <Logo />
              <button
                type="button"
                className="mobileMenuClose"
                aria-label="Close menu"
                onClick={() => setMobileMenuOpen(false)}
              >
                <X size={24} />
              </button>
            </div>

            <nav className="mobileDrawerNav">
              {mobileMoreItems.map(([to, Icon, key]) => (
                <NavLink
                  key={`${to}-${key}`}
                  to={to}
                  onClick={() => setMobileMenuOpen(false)}
                >
                  <Icon size={20} />
                  <span>{t(key)}</span>
                </NavLink>
              ))}
            </nav>

            <button type="button" className="mobileDrawerLogout" onClick={handleLogout}>
              <LogOut size={20} />
              <span>{t('signOut')}</span>
            </button>
          </section>
        </div>
      )}
    </div>
  )
}