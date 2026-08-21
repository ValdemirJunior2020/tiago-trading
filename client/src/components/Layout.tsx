import {
  NavLink,
  Outlet,
  useNavigate,
} from 'react-router-dom'
import {
  Home,
  LineChart,
  Repeat2,
  WalletCards,
  Menu,
  GraduationCap,
  Trophy,
  BrainCircuit,
  History,
  Settings,
  LogOut,
  FlaskConical,
} from 'lucide-react'
import { signOut } from 'firebase/auth'
import { auth, firestore } from '../firebase'
import { Logo } from './Logo'
import { useTranslation } from 'react-i18next'
import { useEffect } from 'react'
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

export function Layout() {
  const { t, i18n } = useTranslation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()

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
      .catch((error) => {
        console.error('Could not load preferences:', error)
      })
  }, [i18n])

  async function handleLogout() {
    try {
      queryClient.clear()

      await signOut(auth)

      sessionStorage.clear()

      navigate('/login', {
        replace: true,
      })
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

        <button
          type="button"
          className="sideLogout"
          onClick={handleLogout}
        >
          <LogOut size={18} />
          {t('signOut')}
        </button>
      </aside>

      <main>
        <div className="simBar">
          <strong>{t('simulator')}</strong>
          <span>{t('disclaimerShort')}</span>
        </div>

        <div className="page">
          <Outlet />
        </div>
      </main>

      <nav className="bottomNav">
        {items.slice(0, 4).map(([to, Icon, key]) => (
          <NavLink key={`${to}-${key}`} to={to}>
            <Icon size={21} />
            <small>{t(key)}</small>
          </NavLink>
        ))}

        <NavLink to="/settings">
          <Menu size={21} />
          <small>{t('more')}</small>
        </NavLink>
      </nav>
    </div>
  )
}