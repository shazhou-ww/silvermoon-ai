import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import StreamsApp from './streams.tsx'
import DevicesApp from './devices.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {window.location.pathname === "/history" || (window.location.pathname === "/" && new URLSearchParams(window.location.search).has("stream"))
      ? <StreamsApp /> : window.location.pathname === "/" ? <DevicesApp /> : <App />}
  </StrictMode>,
)
