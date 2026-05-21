import test from 'node:test'
import assert from 'node:assert/strict'

import {
  createTinyGoHostCompilePlugin,
  DEFAULT_TINYGO_COMPILE_PATH,
} from '../scripts/tinygo-host-compile-vite-plugin.mjs'

const installMiddleware = () => {
  let middleware = null
  const plugin = createTinyGoHostCompilePlugin()
  plugin.configureServer({
    middlewares: {
      use(handler) {
        middleware = handler
      },
    },
  })
  assert.equal(typeof middleware, 'function')
  return middleware
}

const invokeMiddleware = async (middleware, { body = '', method = 'GET', url = DEFAULT_TINYGO_COMPILE_PATH } = {}) => {
  let responseBody = ''
  const headers = new Map()
  let nextCalled = false
  const req = {
    method,
    url,
    async *[Symbol.asyncIterator]() {
      if (body) {
        yield body
      }
    },
  }
  const res = {
    statusCode: 200,
    end(chunk = '') {
      responseBody += String(chunk)
    },
    setHeader(name, value) {
      headers.set(String(name).toLowerCase(), String(value))
    },
  }

  await middleware(req, res, () => {
    nextCalled = true
  })

  return {
    body: responseBody,
    headers,
    nextCalled,
    statusCode: res.statusCode,
  }
}

test('tinygo host compile middleware answers CORS preflight requests', async () => {
  const middleware = installMiddleware()
  const response = await invokeMiddleware(middleware, { method: 'OPTIONS' })

  assert.equal(response.nextCalled, false)
  assert.equal(response.statusCode, 204)
  assert.equal(response.body, '')
  assert.equal(response.headers.get('access-control-allow-origin'), '*')
  assert.equal(response.headers.get('access-control-allow-methods'), 'POST, OPTIONS')
  assert.equal(response.headers.get('access-control-allow-headers'), 'content-type')
})

test('tinygo host compile middleware keeps CORS headers on method errors', async () => {
  const middleware = installMiddleware()
  const response = await invokeMiddleware(middleware, { method: 'GET' })

  assert.equal(response.nextCalled, false)
  assert.equal(response.statusCode, 405)
  assert.match(response.body, /TinyGo host compile only accepts POST requests/)
  assert.equal(response.headers.get('access-control-allow-origin'), '*')
  assert.equal(response.headers.get('content-type'), 'application/json')
})

test('tinygo host compile middleware passes through unrelated paths', async () => {
  const middleware = installMiddleware()
  const response = await invokeMiddleware(middleware, { url: '/not-the-endpoint' })

  assert.equal(response.nextCalled, true)
  assert.equal(response.body, '')
})
