import React from 'react'
import { createRoot } from 'react-dom/client'
// Bundled offline; see https://fontsource.org/docs/guides/vite
import '@fontsource/ibm-plex-sans-arabic/400.css'
import '@fontsource/ibm-plex-sans-arabic/500.css'
import '@fontsource/ibm-plex-sans-arabic/600.css'
import '@fontsource/ibm-plex-sans-arabic/700.css'
import '@fontsource/dm-sans/400.css'
import '@fontsource/dm-sans/600.css'
import '@fontsource/dm-sans/700.css'
import { App } from './App'
import './styles.css'
import './theme-najd.css'
import './theme-graphite.css'
import './effort.css'
import './market.css'
import './graph.css'

// https://react.dev/reference/react-dom/client/createRoot
createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>
)
