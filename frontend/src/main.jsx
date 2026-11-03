import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import './styles/ActionButtons.css'
import './styles/SplitPane.css'
import App from './App.jsx'
import './styles/InputFields.css'
import './styles/PeriodFilters.css'

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
