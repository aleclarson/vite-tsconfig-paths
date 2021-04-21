import React from 'react'
import { renderToString } from 'react-dom/server'
import { Root } from '@/Root'

export function renderPage() {
  return renderToString(<Root />)
}