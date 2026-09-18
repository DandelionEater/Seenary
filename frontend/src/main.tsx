import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import { installApiClient } from './apiClient.ts'
import './index.css'

const hostname = window.location.hostname.toLowerCase()
const isHostedDesktopRenderer = hostname === 'web.seenary.app'
const isHostedSeenary = ['seenary.app', 'www.seenary.app', 'web.seenary.app'].includes(hostname)
const isDesktopRuntime = Boolean(
  window.desktopUpdater &&
  window.desktopEnvironment &&
  window.desktopWindow
)

const useAtlas = isHostedSeenary
  || import.meta.env.VITE_ATLAS_PRODUCTION === 'true'
  || import.meta.env.VITE_ATLAS_STAGING === 'true' && ['localhost', '127.0.0.1'].includes(location.hostname)

if (useAtlas) {
  if (new URLSearchParams(location.search).has('atlasReview')) {
    void import('./cloud/CloudLibrary.tsx').then(({ default: CloudLibrary }) => {
      ReactDOM.createRoot(document.getElementById('root')!).render(<><a href="/">Back to Seenary</a><CloudLibrary /></>)
    })
  } else {
    installApiClient()
    void Promise.all([import('./cloud/rendererAdapter.ts'), import('./cloud/CloudSaveIndicator.tsx')]).then(([{ installAtlasRenderer }, { default: CloudSaveIndicator }]) => {
      installAtlasRenderer(window.api)
      ReactDOM.createRoot(document.getElementById('root')!).render(<><App /><CloudSaveIndicator /></>)
    })
  }
} else if (isHostedDesktopRenderer && !isDesktopRuntime) {
  window.location.replace('https://seenary.app')
} else {
  installApiClient()

  ReactDOM.createRoot(document.getElementById('root')!).render(
    <React.StrictMode>
      <App />
    </React.StrictMode>,
  )
}
