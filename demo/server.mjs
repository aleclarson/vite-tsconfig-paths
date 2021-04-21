import { createServer as createViteServer } from 'vite'
import express from 'express'

export async function createServer() {
  const app = express()

  const vite = await createViteServer({
    root: process.cwd(),
    server: {
      middlewareMode: true,
    },
  })

  app.use(vite.middlewares)

  app.use('*', async (req, res, next) => {
    try {
      const { renderPage } = await vite.ssrLoadModule('/src/entry-server.tsx')
      res.status(200).end(renderPage())
    } catch (error) {
      vite.ssrFixStacktrace(error)
      console.error(error.stack)
      res.status(500).end('Error')
    }
  })

  return { app, vite }
}
async function init() {
  const { app } = await createServer()

  app.listen(3001, () => {
    console.log('Running on http://localhost:3001')
  })
}

init()
