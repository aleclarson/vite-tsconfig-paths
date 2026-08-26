import { createRoot } from 'react-dom/client'
import { Root } from '@/Root'
import '@/styles.css'

const container = document.getElementById('root')
if (!container) throw new Error('Missing #root element')

createRoot(container).render(<Root />)
