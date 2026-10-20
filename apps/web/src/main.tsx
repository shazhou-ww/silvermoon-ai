import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import StreamsApp from './streams.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    {window.location.pathname === "/" ? <StreamsApp /> : <App />}
  </StrictMode>,
)
