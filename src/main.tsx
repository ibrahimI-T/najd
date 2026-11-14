import React from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './workstation/App'

// https://react.dev/reference/react-dom/client/createRoot
createRoot(document.getElementById('root')!).render(
  <React.StrictMode><App /></React.StrictMode>
)
