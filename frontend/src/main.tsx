import React from 'react'
import ReactDOM from 'react-dom/client'
import App from './App.tsx'
import { installApiClient } from './apiClient.ts'
import { isAtlasProduction } from './cloud/config.ts'
import './index.css'

const hostname = window.location.hostname.toLowerCase()
const isHostedDesktopRenderer = hostname === 'web.seenary.app'
const isDesktopRuntime = Boolean(
  window.desktopUpdater &&
  window.desktopEnvironment &&
  window.desktopWindow
)

const useAtlas = isAtlasProduction
  || import.meta.env.VITE_ATLAS_STAGING === 'true' && ['localhost', '127.0.0.1'].includes(location.hostname)
const showCloudSaveIndicator = import.meta.env.VITE_ATLAS_STAGING === 'true'

if (useAtlas) {
  if (new URLSearchParams(location.search).has('atlasReview')) {
    void import('./cloud/CloudLibrary.tsx').then(({ default: CloudLibrary }) => {
      ReactDOM.createRoot(document.getElementById('root')!).render(<><a href="/">Back to Seenary</a><CloudLibrary /></>)
    })
  } else {
    installApiClient()
    void import('./cloud/rendererAdapter.ts').then(({ installAtlasRenderer }) => {
      installAtlasRenderer(window.legacyApi ?? window.api)
      if (showCloudSaveIndicator) {
        void import('./cloud/CloudSaveIndicator.tsx').then(({ default: CloudSaveIndicator }) => {
          ReactDOM.createRoot(document.getElementById('root')!).render(<><App /><CloudSaveIndicator /></>)
        })
        return
      }
      ReactDOM.createRoot(document.getElementById('root')!).render(<App />)
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
