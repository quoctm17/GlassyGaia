import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/index.css'
// Import language-specific styles after base styles so they can override Tailwind utilities when needed
import './styles/language-styles.css'
// Import level framework badge styles
import './styles/level-framework-styles.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
