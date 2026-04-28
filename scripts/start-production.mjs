import { spawn } from 'node:child_process'
import path from 'node:path'
import process from 'node:process'
import nextEnv from '@next/env'

const { loadEnvConfig } = nextEnv

const REQUIRED_ENV_VARS = ['DATABASE_URL', 'NEXTAUTH_SECRET']
const RECOMMENDED_ENV_VARS = ['NEXTAUTH_URL']
const AUTOMATION_BOOT_DELAY_MS = 15000
const AUTOMATION_HEARTBEAT_MS = 60000
const AUTOMATION_ROUTE_PATH = '/api/internal/campaign-automation/run'
const AUTOMATION_SECRET_HEADER = 'x-automation-secret'
const WHATSAPP_APPOINTMENT_CONFIRMATION_BOOT_DELAY_MS = 20000
const WHATSAPP_APPOINTMENT_CONFIRMATION_HEARTBEAT_MS = 300000
const WHATSAPP_APPOINTMENT_CONFIRMATION_ROUTE_PATH = '/api/internal/whatsapp-appointment-confirmations/run'

function getMissingEnvVars(names) {
  return names.filter((name) => !process.env[name]?.trim())
}

function logBoot(event, details = {}) {
  console.info(`[boot] ${event}`, details)
}

function logBootError(event, details = {}) {
  console.error(`[boot] ${event}`, details)
}

function getAutomationRunnerSecret() {
  return process.env.AUTOMATION_RUNNER_SECRET?.trim() || process.env.NEXTAUTH_SECRET?.trim() || null
}

function isCustomerCampaignAutomationEnabled() {
  const rawValue = process.env.CUSTOMER_CAMPAIGN_AUTOMATION_ENABLED?.trim()

  if (!rawValue) {
    return true
  }

  return rawValue.toLowerCase() === 'true'
}

function getInternalBaseUrl(host, port) {
  const normalizedHost = host === '0.0.0.0' || host === '::' ? '127.0.0.1' : host
  return `http://${normalizedHost}:${port}`
}

function summarizeCampaignAutomationReasons(summary) {
  const reasons = {}

  for (const item of summary?.barbershops ?? []) {
    reasons[item.reason] = (reasons[item.reason] ?? 0) + 1
  }

  return reasons
}

function isWhatsAppAppointmentConfirmationEnabled() {
  const rawValue = process.env.WHATSAPP_APPOINTMENT_CONFIRMATIONS_ENABLED?.trim()

  if (!rawValue) {
    return true
  }

  return rawValue.toLowerCase() === 'true'
}

function startCampaignAutomationHeartbeat({ host, port }) {
  if (!isCustomerCampaignAutomationEnabled()) {
    logBoot('campaign_automation_disabled')
    return () => undefined
  }

  const sharedSecret = getAutomationRunnerSecret()

  if (!sharedSecret) {
    logBootError('campaign_automation_missing_secret')
    return () => undefined
  }

  const baseUrl = getInternalBaseUrl(host, port)
  let timer = null
  let stopped = false
  let inFlight = false

  const tick = async () => {
    if (stopped || inFlight) {
      return
    }

    inFlight = true

    try {
      const response = await fetch(`${baseUrl}${AUTOMATION_ROUTE_PATH}`, {
        method: 'POST',
        headers: {
          [AUTOMATION_SECRET_HEADER]: sharedSecret,
        },
      })

      if (!response.ok) {
        const text = await response.text().catch(() => '')
        logBootError('campaign_automation_tick_failed', {
          status: response.status,
          body: text || response.statusText,
        })
        return
      }

      const payload = await response.json().catch(() => null)
      const summary = payload?.summary ?? null
      const checkedBarbershops = summary?.checkedBarbershops ?? 0
      const dueBarbershops = summary?.dueBarbershops ?? 0
      const createdRuns = summary?.createdRuns ?? 0
      const failedRuns = summary?.failedRuns ?? 0
      const deliveriesSent = summary?.deliveriesSent ?? 0
      const deliveriesFailed = summary?.deliveriesFailed ?? 0
      const deliveriesCreated = summary?.deliveriesCreated ?? 0
      const deliveriesSkipped = summary?.deliveriesSkipped ?? 0
      const reasons = summarizeCampaignAutomationReasons(summary)

      if (createdRuns === 0 && failedRuns === 0) {
        logBoot(dueBarbershops > 0 ? 'campaign_automation_tick_noop' : 'campaign_automation_tick_waiting_window', {
          checkedBarbershops,
          dueBarbershops,
          skippedRuns: summary?.skippedRuns ?? 0,
          reasons,
        })
        return
      }

      logBoot('campaign_automation_tick_completed', {
        checkedBarbershops,
        dueBarbershops,
        createdRuns,
        failedRuns,
        deliveriesCreated,
        deliveriesSent,
        deliveriesFailed,
        deliveriesSkipped,
        reasons,
      })
    } catch (error) {
      logBootError('campaign_automation_tick_error', {
        message: error instanceof Error ? error.message : String(error),
      })
    } finally {
      inFlight = false
    }
  }

  const initialTimer = setTimeout(() => {
    if (stopped) {
      return
    }

    tick().catch(() => undefined)
    timer = setInterval(() => {
      tick().catch(() => undefined)
    }, AUTOMATION_HEARTBEAT_MS)
  }, AUTOMATION_BOOT_DELAY_MS)

  logBoot('campaign_automation_heartbeat_started', {
    baseUrl,
    route: AUTOMATION_ROUTE_PATH,
    bootDelayMs: AUTOMATION_BOOT_DELAY_MS,
    intervalMs: AUTOMATION_HEARTBEAT_MS,
  })

  return () => {
    stopped = true
    clearTimeout(initialTimer)
    if (timer) {
      clearInterval(timer)
    }
  }
}

function startWhatsAppAppointmentConfirmationHeartbeat({ host, port }) {
  if (!isWhatsAppAppointmentConfirmationEnabled()) {
    logBoot('whatsapp_appointment_confirmation_disabled')
    return () => undefined
  }

  const sharedSecret = getAutomationRunnerSecret()

  if (!sharedSecret) {
    logBootError('whatsapp_appointment_confirmation_missing_secret')
    return () => undefined
  }

  const baseUrl = getInternalBaseUrl(host, port)
  let timer = null
  let stopped = false
  let inFlight = false

  const tick = async () => {
    if (stopped || inFlight) {
      return
    }

    inFlight = true

    try {
      const response = await fetch(`${baseUrl}${WHATSAPP_APPOINTMENT_CONFIRMATION_ROUTE_PATH}`, {
        method: 'POST',
        headers: {
          [AUTOMATION_SECRET_HEADER]: sharedSecret,
        },
      })

      if (!response.ok) {
        const text = await response.text().catch(() => '')
        logBootError('whatsapp_appointment_confirmation_tick_failed', {
          status: response.status,
          body: text || response.statusText,
        })
        return
      }

      const payload = await response.json().catch(() => null)
      const summary = payload?.summary ?? null

      logBoot('whatsapp_appointment_confirmation_tick_completed', {
        scannedAppointments: summary?.scannedAppointments ?? 0,
        dueAppointmentsFound: summary?.dueAppointmentsFound ?? 0,
        sent: summary?.sent ?? 0,
        skipped: summary?.skipped ?? 0,
        failed: summary?.failed ?? 0,
      })
    } catch (error) {
      logBootError('whatsapp_appointment_confirmation_tick_error', {
        message: error instanceof Error ? error.message : String(error),
      })
    } finally {
      inFlight = false
    }
  }

  const initialTimer = setTimeout(() => {
    if (stopped) {
      return
    }

    tick().catch(() => undefined)
    timer = setInterval(() => {
      tick().catch(() => undefined)
    }, WHATSAPP_APPOINTMENT_CONFIRMATION_HEARTBEAT_MS)
  }, WHATSAPP_APPOINTMENT_CONFIRMATION_BOOT_DELAY_MS)

  logBoot('whatsapp_appointment_confirmation_heartbeat_started', {
    baseUrl,
    route: WHATSAPP_APPOINTMENT_CONFIRMATION_ROUTE_PATH,
    bootDelayMs: WHATSAPP_APPOINTMENT_CONFIRMATION_BOOT_DELAY_MS,
    intervalMs: WHATSAPP_APPOINTMENT_CONFIRMATION_HEARTBEAT_MS,
  })

  return () => {
    stopped = true
    clearTimeout(initialTimer)
    if (timer) {
      clearInterval(timer)
    }
  }
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

  const stopCampaignAutomationHeartbeat = startCampaignAutomationHeartbeat({
    host,
    port,
  })
  const stopWhatsAppAppointmentConfirmationHeartbeat = startWhatsAppAppointmentConfirmationHeartbeat({
    host,
    port,
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

    stopCampaignAutomationHeartbeat()
    stopWhatsAppAppointmentConfirmationHeartbeat()
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
    stopCampaignAutomationHeartbeat()
    stopWhatsAppAppointmentConfirmationHeartbeat()
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
