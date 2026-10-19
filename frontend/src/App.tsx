import { lazy, Suspense } from 'react'

// Одна сборка, два входа: /app открывает рабочую версию кабинета, всё остальное презентацию.
// На GitHub Pages /app отдаётся файлом app.html (копия index.html, см. build в package.json).
const Landing = lazy(() => import('./landing/Landing'))
const DesktopApp = lazy(() => import('./app/DesktopApp'))

const isAppPath = () => /\/app(\.html)?\/?$/.test(window.location.pathname)

export default function App() {
  return <Suspense fallback={null}>{isAppPath() ? <DesktopApp /> : <Landing />}</Suspense>
}
