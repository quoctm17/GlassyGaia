import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './styles/index.css'
// Import language-specific styles after base styles so they can override Tailwind utilities when needed
import './styles/language-styles.css'
// Import level framework badge styles
import './styles/level-framework-styles.css'
// Import admin page-specific styles
import './styles/pages/admin/content-detail.css'
import './styles/pages/admin/card-detail.css'
import './styles/pages/admin/episode-detail.css'
import './styles/pages/admin/content-forms.css'
import './styles/pages/admin/card-update.css'
import './styles/pages/admin/migration-pages.css'
// Import admin component styles
import './styles/components/admin/csv-preview.css'
import App from './App.tsx'

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
