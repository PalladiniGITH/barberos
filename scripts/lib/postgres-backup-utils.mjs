import { spawn } from 'node:child_process'
import crypto from 'node:crypto'
import fs from 'node:fs'
import fsPromises from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import nextEnv from '@next/env'

const { loadEnvConfig } = nextEnv

const DEFAULT_LINUX_BACKUP_DIR = '/var/backups/barbermain/postgres'
const DEFAULT_WINDOWS_BACKUP_DIR = path.join(process.cwd(), '.backups', 'postgres')
const DEFAULT_RETENTION_DAILY = 7
const DEFAULT_CRON_HOUR = 3
const DEFAULT_CRON_MINUTE = 15
const DEFAULT_BACKUP_TIMEZONE = 'America/Sao_Paulo'
const DEFAULT_LOCK_STALE_MS = 6 * 60 * 60 * 1000

export function loadProjectEnv() {
  loadEnvConfig(process.cwd())
}

export function logBackup(event, details = {}) {
  console.info(`[db-backup] ${event}`, details)
}

export function logRestore(event, details = {}) {
  console.info(`[db-restore] ${event}`, details)
}

export function logBackupError(event, details = {}) {
  console.error(`[db-backup] ${event}`, details)
}

export function logRestoreError(event, details = {}) {
  console.error(`[db-restore] ${event}`, details)
}

export function parseCliArgs(argv) {
  const flags = new Map()
  const positionals = []

  for (let index = 0; index < argv.length; index += 1) {
    const current = argv[index]

    if (!current.startsWith('--')) {
      positionals.push(current)
      continue
    }

    const [rawKey, inlineValue] = current.split('=', 2)
    const key = rawKey.slice(2)

    if (inlineValue !== undefined) {
      flags.set(key, inlineValue)
      continue
    }

    const next = argv[index + 1]

    if (!next || next.startsWith('--')) {
      flags.set(key, true)
      continue
    }

    flags.set(key, next)
    index += 1
  }

  return { flags, positionals }
}

function sanitizeValue(value) {
  if (!value) {
    return value
  }

  return String(value)
    .replace(/:\/\/([^:]+):([^@]+)@/g, '://$1:[REDACTED]@')
    .replace(/password=[^&]+/gi, 'password=[REDACTED]')
    .replace(/postgresql:\/\/([^@]+)@/gi, 'postgresql://[REDACTED]@')
}

export function parseDatabaseUrl(rawUrl) {
  if (!rawUrl?.trim()) {
    throw new Error('DATABASE_URL ausente para o backup do PostgreSQL.')
  }

  const url = new URL(rawUrl)

  if (!['postgresql:', 'postgres:'].includes(url.protocol)) {
    throw new Error(`DATABASE_URL invalida para PostgreSQL: ${sanitizeValue(rawUrl)}`)
  }

  const database = url.pathname.replace(/^\/+/, '').split('/')[0]

  if (!database) {
    throw new Error('DATABASE_URL sem nome de banco.')
  }

  return {
    protocol: url.protocol,
    host: url.hostname,
    port: url.port || '5432',
    database,
    username: decodeURIComponent(url.username),
    password: decodeURIComponent(url.password),
    schema: url.searchParams.get('schema') || null,
    rawUrl,
  }
}

export function redactDatabaseTarget(rawUrl) {
  const parsed = parseDatabaseUrl(rawUrl)
  return `${parsed.host}:${parsed.port}/${parsed.database}`
}

function readIntegerEnv(name, fallback) {
  const raw = process.env[name]?.trim()

  if (!raw) {
    return fallback
  }

  const parsed = Number.parseInt(raw, 10)

  if (!Number.isFinite(parsed)) {
    throw new Error(`${name} invalida: ${raw}`)
  }

  return parsed
}

function isLocalDatabaseHost(host) {
  return ['localhost', '127.0.0.1', '::1'].includes(host)
}

function resolveDefaultBackupContainer(host) {
  if (!host || isLocalDatabaseHost(host) || host.includes('.')) {
    return null
  }

  return host
}

export function getBackupRuntimeConfig() {
  loadProjectEnv()

  const database = parseDatabaseUrl(process.env.DATABASE_URL)
  const backupRoot = process.env.POSTGRES_BACKUP_DIR?.trim()
    || (process.platform === 'win32' ? DEFAULT_WINDOWS_BACKUP_DIR : DEFAULT_LINUX_BACKUP_DIR)
  const retentionDaily = readIntegerEnv('POSTGRES_BACKUP_RETENTION_DAILY', DEFAULT_RETENTION_DAILY)
  const cronHour = readIntegerEnv('POSTGRES_BACKUP_CRON_HOUR', DEFAULT_CRON_HOUR)
  const cronMinute = readIntegerEnv('POSTGRES_BACKUP_CRON_MINUTE', DEFAULT_CRON_MINUTE)
  const timezone = process.env.POSTGRES_BACKUP_TIMEZONE?.trim()
    || process.env.APP_TIMEZONE?.trim()
    || DEFAULT_BACKUP_TIMEZONE
  const container = process.env.POSTGRES_BACKUP_CONTAINER?.trim() || resolveDefaultBackupContainer(database.host)
  const dockerBinary = process.env.DOCKER_BIN?.trim() || 'docker'
  const lockStaleMs = readIntegerEnv('POSTGRES_BACKUP_LOCK_STALE_MS', DEFAULT_LOCK_STALE_MS)
  const dailyDir = path.join(backupRoot, 'daily')
  const weeklyDir = path.join(backupRoot, 'weekly')
  const logsDir = path.join(backupRoot, 'logs')
  const logFile = path.join(logsDir, 'postgres-backup.log')

  return {
    backupRoot,
    dailyDir,
    weeklyDir,
    logsDir,
    logFile,
    retentionDaily,
    cronHour,
    cronMinute,
    timezone,
    container,
    dockerBinary,
    lockStaleMs,
    nodeBinary: process.execPath,
    projectRoot: process.cwd(),
    database,
  }
}

export async function ensureDirectory(dirPath) {
  await fsPromises.mkdir(dirPath, { recursive: true })
}

export function formatBackupTimestamp(date = new Date(), timeZone = DEFAULT_BACKUP_TIMEZONE) {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
  const parts = Object.fromEntries(formatter.formatToParts(date).map((part) => [part.type, part.value]))

  return `${parts.year}${parts.month}${parts.day}-${parts.hour}${parts.minute}${parts.second}`
}

export function buildBackupFileName(databaseName, timestamp) {
  return `${databaseName}_${timestamp}.dump`
}

export async function runCommand(command, args, options = {}) {
  const {
    env,
    cwd,
    stdin,
  } = options

  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      env: { ...process.env, ...env },
      cwd,
      stdio: ['pipe', 'pipe', 'pipe'],
    })

    let stdout = ''
    let stderr = ''

    child.stdout.on('data', (chunk) => {
      stdout += chunk.toString()
    })

    child.stderr.on('data', (chunk) => {
      stderr += chunk.toString()
    })

    child.on('error', (error) => {
      reject(error)
    })

    child.on('close', (code) => {
      if (code === 0) {
        resolve({ stdout, stderr, code })
        return
      }

      reject(new Error(stderr.trim() || stdout.trim() || `${command} exited with code ${code}`))
    })

    if (stdin) {
      child.stdin.write(stdin)
    }

    child.stdin.end()
  })
}

export async function commandExists(command, args = ['--version']) {
  try {
    await runCommand(command, args)
    return true
  } catch {
    return false
  }
}

export async function dockerContainerExists(dockerBinary, containerName) {
  if (!containerName) {
    return false
  }

  try {
    await runCommand(dockerBinary, ['inspect', containerName])
    return true
  } catch {
    return false
  }
}

export async function resolveBackupStrategy(config) {
  const forced = process.env.POSTGRES_BACKUP_STRATEGY?.trim()

  if (forced === 'docker-exec') {
    if (!config.container) {
      throw new Error('POSTGRES_BACKUP_STRATEGY=docker-exec, mas nenhum container foi resolvido.')
    }
    return 'docker-exec'
  }

  if (forced === 'local') {
    return 'local'
  }

  if (config.container && await dockerContainerExists(config.dockerBinary, config.container)) {
    return 'docker-exec'
  }

  if (await commandExists('pg_dump') && await commandExists('pg_restore')) {
    return 'local'
  }

  throw new Error(
    'Nao foi possivel resolver uma estrategia de backup. Configure POSTGRES_BACKUP_CONTAINER ou instale pg_dump/pg_restore no host.'
  )
}

export async function writeSha256File(filePath) {
  const hash = crypto.createHash('sha256')
  await new Promise((resolve, reject) => {
    const stream = fs.createReadStream(filePath)

    stream.on('data', (chunk) => hash.update(chunk))
    stream.on('error', reject)
    stream.on('end', resolve)
  })

  const digest = hash.digest('hex')
  const shaFilePath = `${filePath}.sha256`
  const fileName = path.basename(filePath)

  await fsPromises.writeFile(shaFilePath, `${digest}  ${fileName}\n`, 'utf8')

  return { shaFilePath, digest }
}

export async function writeBackupMetadata(filePath, metadata) {
  const metaPath = `${filePath}.json`
  await fsPromises.writeFile(metaPath, `${JSON.stringify(metadata, null, 2)}\n`, 'utf8')
  return metaPath
}

export async function getFileSize(filePath) {
  const stats = await fsPromises.stat(filePath)
  return stats.size
}

export async function pruneBackups(dailyDir, keepLatest) {
  const entries = await fsPromises.readdir(dailyDir, { withFileTypes: true }).catch(() => [])
  const backups = []

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith('.dump')) {
      continue
    }

    const fullPath = path.join(dailyDir, entry.name)
    const stats = await fsPromises.stat(fullPath)
    backups.push({
      fullPath,
      name: entry.name,
      mtimeMs: stats.mtimeMs,
    })
  }

  backups.sort((left, right) => right.mtimeMs - left.mtimeMs)

  const toDelete = backups.slice(keepLatest)
  const deleted = []

  for (const entry of toDelete) {
    await fsPromises.unlink(entry.fullPath).catch(() => undefined)
    await fsPromises.unlink(`${entry.fullPath}.sha256`).catch(() => undefined)
    await fsPromises.unlink(`${entry.fullPath}.json`).catch(() => undefined)
    deleted.push(entry.name)
  }

  return deleted
}

export async function acquireFileLock(lockFilePath, staleAfterMs) {
  try {
    const handle = await fsPromises.open(lockFilePath, 'wx')
    await handle.writeFile(`${process.pid}\n${new Date().toISOString()}\n`)

    return async () => {
      await handle.close().catch(() => undefined)
      await fsPromises.unlink(lockFilePath).catch(() => undefined)
    }
  } catch (error) {
    if (error && typeof error === 'object' && 'code' in error && error.code === 'EEXIST') {
      const stats = await fsPromises.stat(lockFilePath).catch(() => null)

      if (stats && Date.now() - stats.mtimeMs > staleAfterMs) {
        await fsPromises.unlink(lockFilePath).catch(() => undefined)
        return acquireFileLock(lockFilePath, staleAfterMs)
      }

      throw new Error(`Ja existe um backup em andamento: lock ativo em ${lockFilePath}`)
    }

    throw error
  }
}

export function formatBytes(bytes) {
  if (!Number.isFinite(bytes) || bytes < 1024) {
    return `${bytes} B`
  }

  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes
  let unitIndex = -1

  do {
    value /= 1024
    unitIndex += 1
  } while (value >= 1024 && unitIndex < units.length - 1)

  return `${value.toFixed(2)} ${units[unitIndex]}`
}

export async function countPublicTablesWithPsql(commandRunner, targetLabel = 'restore') {
  const tableCount = await commandRunner([
    '-Atc',
    "SELECT COUNT(*) FROM information_schema.tables WHERE table_schema = 'public';",
  ])

  const parsed = Number.parseInt(tableCount.stdout.trim(), 10)

  if (!Number.isFinite(parsed) || parsed <= 0) {
    throw new Error(`Validacao do ${targetLabel} falhou: nenhuma tabela publica encontrada.`)
  }

  return parsed
}

export function requireFlag(flags, name, message) {
  const value = flags.get(name)

  if (!value || value === true) {
    throw new Error(message)
  }

  return value
}
