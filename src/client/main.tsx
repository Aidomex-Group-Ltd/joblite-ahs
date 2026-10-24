import React from 'react'
import ReactDOM from 'react-dom/client'
import { BrowserRouter } from 'react-router-dom'
import App from './App'
import './styles/index.css'
import './styles/joblite-theme.css'
import { SessionProvider } from './lib/session'

class RootErrorBoundary extends React.Component<
  { children: React.ReactNode },
  { failed: boolean }
> {
  state = { failed: false }

  static getDerivedStateFromError() {
    return { failed: true }
  }

  componentDidCatch(error: Error, info: React.ErrorInfo) {
    console.error('Joblite could not render the current page', error, info.componentStack)
  }

  render() {
    if (this.state.failed) {
      return (
        <main
          role="alert"
          style={{
            minHeight: '100dvh',
            display: 'grid',
            placeContent: 'center',
            gap: 12,
            padding: 24,
            color: '#12213f',
            background: '#f5f8fc',
            fontFamily: 'Inter, system-ui, sans-serif',
            textAlign: 'center',
          }}
        >
          <h1>Joblite couldn’t load this page</h1>
          <p>Please reload to try again.</p>
          <button
            type="button"
            onClick={() => window.location.reload()}
            style={{
              justifySelf: 'center',
              minHeight: 44,
              padding: '10px 20px',
              border: 0,
              borderRadius: 999,
              color: 'white',
              background: '#0866ff',
              font: 'inherit',
              fontWeight: 700,
              cursor: 'pointer',
            }}
          >
            Reload Joblite
          </button>
        </main>
      )
    }

    return this.props.children
  }
}

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RootErrorBoundary>
      <BrowserRouter>
        <SessionProvider>
          <App />
        </SessionProvider>
      </BrowserRouter>
    </RootErrorBoundary>
  </React.StrictMode>,
)
