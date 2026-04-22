process.env.NODE_ENV = 'test'
process.env.OPENAI_API_KEY = ''
process.env.APP_TIMEZONE = process.env.APP_TIMEZONE || 'America/Sao_Paulo'

const Module = require('module')
const path = require('path')

const originalResolveFilename = Module._resolveFilename

Module._resolveFilename = function resolveFilename(request, parent, isMain, options) {
  if (request === 'server-only') {
    return path.join(__dirname, 'server-only-stub.js')
  }

  if (request === '@auth/prisma-adapter') {
    return path.join(__dirname, 'auth-prisma-adapter-stub.js')
  }

  if (request.startsWith('@/')) {
    const mappedPath = path.join(process.cwd(), 'src', request.slice(2))
    return originalResolveFilename.call(this, mappedPath, parent, isMain, options)
  }

  return originalResolveFilename.call(this, request, parent, isMain, options)
}

require('ts-node').register({
  transpileOnly: true,
  compilerOptions: {
    module: 'CommonJS',
    moduleResolution: 'node',
  },
})
