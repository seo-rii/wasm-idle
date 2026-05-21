const DEFAULT_TINYGO_COMPILE_PATH = '/api/tinygo/compile'
const DEFAULT_TINYGO_HOST_COMPILER_MODULE_URL = new URL('./tinygo-host-compiler.mjs', import.meta.url).href

export { DEFAULT_TINYGO_COMPILE_PATH }

export function createTinyGoHostCompilePlugin({
  compilePath = DEFAULT_TINYGO_COMPILE_PATH,
  compilerModuleUrl = DEFAULT_TINYGO_HOST_COMPILER_MODULE_URL,
} = {}) {
  const installMiddleware = (middlewares) => {
    middlewares.use(async (req, res, next) => {
      if (!req.url) {
        next()
        return
      }
      const requestUrl = new URL(req.url, 'http://localhost')
      if (requestUrl.pathname !== compilePath) {
        next()
        return
      }

      res.setHeader('access-control-allow-origin', '*')
      res.setHeader('access-control-allow-methods', 'POST, OPTIONS')
      res.setHeader('access-control-allow-headers', 'content-type')
      res.setHeader('access-control-max-age', '86400')

      if (req.method === 'OPTIONS') {
        res.statusCode = 204
        res.end()
        return
      }
      if (req.method !== 'POST') {
        res.statusCode = 405
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ error: 'TinyGo host compile only accepts POST requests' }))
        return
      }

      let requestBody = ''
      for await (const chunk of req) {
        requestBody += String(chunk)
      }

      let payload = {}
      try {
        payload = requestBody.trim() ? JSON.parse(requestBody) : {}
      } catch {
        res.statusCode = 400
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ error: 'TinyGo host compile received invalid JSON' }))
        return
      }

      try {
        const compilerModule = await import(
          /* @vite-ignore */ compilerModuleUrl
        )
        const result =
          payload.files && Object.keys(payload.files).length > 0
            ? await compilerModule.compileTinyGoHostWorkspace({
                entryFileName: payload.entryFileName || 'main.go',
                files: payload.files,
                optimize: payload.optimize,
                panic: payload.panic,
                scheduler: payload.scheduler,
                target: payload.target,
              })
            : await compilerModule.compileTinyGoHostSource({
                optimize: payload.optimize,
                panic: payload.panic,
                scheduler: payload.scheduler,
                source: payload.source || '',
                target: payload.target,
              })
        res.statusCode = 200
        res.setHeader('content-type', 'application/json')
        res.end(
          JSON.stringify({
            artifact: {
              bytesBase64: Buffer.from(result.artifact.bytes).toString('base64'),
              entrypoint: result.artifact.entrypoint,
              path: result.artifact.path,
              runnable: result.artifact.entrypoint !== null,
            },
            logs: [
              `tinygo host compile ready: target=${result.target} scheduler=${result.targetInfo.scheduler || 'unknown'} version=${result.toolchain.version}`,
              `tinygo host artifact built: ${result.artifact.path} (${result.artifact.size} bytes)`,
            ],
          }),
        )
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error)
        res.statusCode =
          message.includes('TinyGo release fetch failed') || message.includes('toolchain')
            ? 503
            : 422
        res.setHeader('content-type', 'application/json')
        res.end(JSON.stringify({ error: message }))
      }
    })
  }

  return {
    configurePreviewServer(server) {
      installMiddleware(server.middlewares)
    },
    configureServer(server) {
      installMiddleware(server.middlewares)
    },
    name: 'tinygo-host-compile',
  }
}
