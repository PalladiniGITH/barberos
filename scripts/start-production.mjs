import { spawn } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import nextEnv from '@next/env'

const { loadEnvConfig } = nextEnv

const REQUIRED_ENV_VARS = ['DATABASE_URL', 'NEXTAUTH_SECRET']
const RECOMMENDED_ENV_VARS = ['NEXTAUTH_URL']

function getMissingEnvVars(names) {
  return names.filter((name) => !process.env[name]?.trim())
}

function logBoot(event, details = {}) {
  console.info(`[boot] ${event}`, details)
}

function logBootError(event, details = {}) {
  console.error(`[boot] ${event}`, details)
}

async function verifyPrismaConnection() {
  const { PrismaClient } = await import('@prisma/client')
  const prisma = new PrismaClient({ log: ['error'] })

  try {
    await prisma.$connect()
    await prisma.$queryRaw`SELECT 1`
    logBoot('prisma_connected')
  } finally {
    await prisma.$disconnect().catch(() => undefined)
  }
}

async function main() {
  if (!process.env.NODE_ENV) {
    process.env.NODE_ENV = 'production'
  }

  loadEnvConfig(process.cwd())

  const missingRequired = getMissingEnvVars(REQUIRED_ENV_VARS)
  const missingRecommended = getMissingEnvVars(RECOMMENDED_ENV_VARS)
  const port = process.env.PORT?.trim() || '3000'
  const host = process.env.APP_HOST?.trim() || '0.0.0.0'

  logBoot('starting_preflight', {
    nodeEnv: process.env.NODE_ENV ?? 'undefined',
    port,
    host,
    hasDatabaseUrl: !missingRequired.includes('DATABASE_URL'),
    hasNextAuthSecret: !missingRequired.includes('NEXTAUTH_SECRET'),
    hasNextAuthUrl: !missingRecommended.includes('NEXTAUTH_URL'),
  })

  if (missingRequired.length > 0) {
    logBootError('missing_required_env', { missingRequired })
    process.exit(1)
  }

  if (missingRecommended.length > 0) {
    console.warn('[boot] missing_recommended_env', { missingRecommended })
  }

  await verifyPrismaConnection()

  const nextBin = path.join(process.cwd(), 'node_modules', 'next', 'dist', 'bin', 'next')
  const child = spawn(process.execPath, [nextBin, 'start', '-H', host, '-p', port], {
    stdio: 'inherit',
    env: process.env,
  })

  logBoot('next_started', {
    pid: child.pid,
    host,
    port,
  })

  let forwardingSignal = false

  const forwardSignal = (signal) => {
    if (forwardingSignal) {
      return
    }

    forwardingSignal = true
    console.warn('[boot] received_signal', { signal, childPid: child.pid })

    if (!child.killed) {
      child.kill(signal)
    }
  }

  process.on('SIGTERM', () => forwardSignal('SIGTERM'))
  process.on('SIGINT', () => forwardSignal('SIGINT'))
  process.on('uncaughtException', (error) => {
    logBootError('uncaught_exception', {
      message: error instanceof Error ? error.message : String(error),
      stack: error instanceof Error ? error.stack : undefined,
    })
  })
  process.on('unhandledRejection', (reason) => {
    logBootError('unhandled_rejection', {
      reason: reason instanceof Error ? reason.message : String(reason),
      stack: reason instanceof Error ? reason.stack : undefined,
    })
  })

  child.on('exit', (code, signal) => {
    console.warn('[boot] next_exited', { code, signal })
    process.exit(code ?? (signal ? 1 : 0))
  })
}

main().catch((error) => {
  logBootError('startup_failed', {
    message: error instanceof Error ? error.message : String(error),
    stack: error instanceof Error ? error.stack : undefined,
  })
  process.exit(1)
})
