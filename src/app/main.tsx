import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './App'
import './tokens.css'
import './estilos.css'
import './console.css'

const raiz = document.getElementById('raiz')
if (raiz) createRoot(raiz).render(<StrictMode><App /></StrictMode>)
