import { Component, lazy, Suspense, type ErrorInfo, type ReactNode } from 'react'
import App from './App'

const AdminApp = lazy(() => import('./admin/AdminApp'))

class AppErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: ErrorInfo) {
    console.error('Application error', error, info.componentStack)
  }

  render() {
    if (this.state.failed) {
      return (
        <div role="alert" style={{ padding: '4rem 1.5rem', maxWidth: 640, margin: 'auto' }}>
          <h1>ElMorenaje Cuts</h1>
          <p>No pudimos abrir esta página. / We could not open this page.</p>
          <button onClick={() => window.location.reload()}>Reintentar / Retry</button>
        </div>
      )
    }
    return this.props.children
  }
}

export default function Root() {
  const isAdmin = /^\/admin(?:\/|$)/.test(window.location.pathname)
  return (
    <AppErrorBoundary>
      <Suspense fallback={<div role="status" style={{ padding: '4rem 1.5rem' }}>Cargando / Loading…</div>}>
        {isAdmin ? <AdminApp /> : <App />}
      </Suspense>
    </AppErrorBoundary>
  )
}
