import { lazy, Suspense, useEffect, useState } from 'react'

// Одна сборка, два входа: /app открывает рабочую версию кабинета, всё остальное презентацию.
// На GitHub Pages /app отдаётся файлом app.html (копия index.html, см. build в package.json).
const Landing = lazy(() => import('./landing/Landing'))
const ResetPassword = lazy(() => import('./app/ResetPassword'))
const DesktopApp = lazy(() => import('./app/DesktopApp'))

const isAppPath = () => /\/app(\.html)?\/?$/.test(window.location.pathname)

export default function App() {
  const [resetToken, setResetToken] = useState(() => new URLSearchParams(window.location.hash.slice(1)).get('reset'))
  useEffect(() => {
    const changed = (event: HashChangeEvent) => {
      const token = new URLSearchParams(new URL(event.newURL).hash.slice(1)).get('reset')
      if (token !== null) event.stopImmediatePropagation()
      setResetToken(token)
    }
    window.addEventListener('hashchange', changed, true)
    return () => window.removeEventListener('hashchange', changed, true)
  }, [])
  return <Suspense fallback={null}>{isAppPath() ? (resetToken !== null ? <ResetPassword key={resetToken} token={resetToken} /> : <DesktopApp />) : <Landing />}</Suspense>
}
