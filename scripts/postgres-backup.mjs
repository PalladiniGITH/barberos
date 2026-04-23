import fsPromises from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import {
  acquireFileLock,
  buildBackupFileName,
  countPublicTablesWithPsql,
  dockerContainerExists,
  ensureDirectory,
  formatBackupTimestamp,
  formatBytes,
  getBackupRuntimeConfig,
  getFileSize,
  logBackup,
  logBackupError,
  parseCliArgs,
  pruneBackups,
  redactDatabaseTarget,
  resolveBackupStrategy,
  runCommand,
  writeBackupMetadata,
  writeSha256File,
} from './lib/postgres-backup-utils.mjs'

const HELP_TEXT = `
Backup completo do PostgreSQL com retencao diaria.

Uso:
  node scripts/postgres-backup.mjs
  node scripts/postgres-backup.mjs --help

Variaveis principais:
  POSTGRES_BACKUP_DIR             diretorio raiz dos backups
  POSTGRES_BACKUP_RETENTION_DAILY quantidade de dumps diarios mantidos
  POSTGRES_BACKUP_CONTAINER       container do Postgres no host Docker/EasyPanel
  POSTGRES_BACKUP_STRATEGY        docker-exec | local
  POSTGRES_BACKUP_TIMEZONE        timezone do timestamp e do cron

Saida padrao:
  /var/backups/barbermain/postgres/daily/*.dump
`.trim()

async function runDockerBackup(config, archivePath, archiveName) {
  const tempArchivePath = `/tmp/${archiveName}`
  const dockerEnv = {
    PGPASSWORD: config.database.password,
  }

  try {
    await runCommand(config.dockerBinary, [
      'exec',
      '-e',
      `PGPASSWORD=${config.database.password}`,
      config.container,
      'pg_dump',
      '-h',
      '127.0.0.1',
      '-p',
      config.database.port,
      '-U',
      config.database.username,
      '-d',
      config.database.database,
      '-F',
      'c',
      '-Z',
      '9',
      '--no-owner',
      '--no-privileges',
      '-f',
      tempArchivePath,
    ], { env: dockerEnv })

    await runCommand(config.dockerBinary, [
      'exec',
      '-e',
      `PGPASSWORD=${config.database.password}`,
      config.container,
      'pg_restore',
      '--list',
      tempArchivePath,
    ], { env: dockerEnv })

    await runCommand(config.dockerBinary, [
      'cp',
      `${config.container}:${tempArchivePath}`,
      archivePath,
    ])
  } finally {
    await runCommand(config.dockerBinary, [
      'exec',
      config.container,
      'rm',
      '-f',
      tempArchivePath,
    ]).catch(() => undefined)
  }

  return {
    strategy: 'docker-exec',
    validation: 'pg_restore --list no container',
  }
}

async function runLocalBackup(config, archivePath) {
  await runCommand('pg_dump', [
    '-h',
    config.database.host,
    '-p',
    config.database.port,
    '-U',
    config.database.username,
    '-d',
    config.database.database,
    '-F',
    'c',
    '-Z',
    '9',
    '--no-owner',
    '--no-privileges',
    '-f',
    archivePath,
  ], {
    env: { PGPASSWORD: config.database.password },
  })

  await runCommand('pg_restore', [
    '--list',
    archivePath,
  ], {
    env: { PGPASSWORD: config.database.password },
  })

  return {
    strategy: 'local',
    validation: 'pg_restore --list local',
  }
}

async function main() {
  const { flags } = parseCliArgs(process.argv.slice(2))

  if (flags.has('help')) {
    console.log(HELP_TEXT)
    return
  }

  const config = getBackupRuntimeConfig()
  const strategy = await resolveBackupStrategy(config)

  await ensureDirectory(config.backupRoot)
  await ensureDirectory(config.dailyDir)
  await ensureDirectory(config.weeklyDir)
  await ensureDirectory(config.logsDir)

  const lockFilePath = path.join(config.backupRoot, '.backup.lock')
  const releaseLock = await acquireFileLock(lockFilePath, config.lockStaleMs)

  try {
    if (strategy === 'docker-exec' && config.container) {
      const containerExists = await dockerContainerExists(config.dockerBinary, config.container)

      if (!containerExists) {
        throw new Error(`Container de backup nao encontrado: ${config.container}`)
      }
    }

    const timestamp = formatBackupTimestamp(new Date(), config.timezone)
    const archiveName = buildBackupFileName(config.database.database, timestamp)
    const archivePath = path.join(config.dailyDir, archiveName)

    logBackup('starting', {
      strategy,
      backupTarget: redactDatabaseTarget(config.database.rawUrl),
      backupDir: config.dailyDir,
      retentionDaily: config.retentionDaily,
      container: config.container ?? null,
    })

    const backupResult = strategy === 'docker-exec'
      ? await runDockerBackup(config, archivePath, archiveName)
      : await runLocalBackup(config, archivePath)

    const [{ digest }, sizeBytes] = await Promise.all([
      writeSha256File(archivePath),
      getFileSize(archivePath),
    ])

    const deletedBackups = await pruneBackups(config.dailyDir, config.retentionDaily)

    const metaPath = await writeBackupMetadata(archivePath, {
      createdAt: new Date().toISOString(),
      timezone: config.timezone,
      backupFile: archivePath,
      sizeBytes,
      sizeHuman: formatBytes(sizeBytes),
      sha256: digest,
      strategy: backupResult.strategy,
      validation: backupResult.validation,
      databaseTarget: redactDatabaseTarget(config.database.rawUrl),
      retentionDaily: config.retentionDaily,
      deletedBackups,
      weeklyDirectoryPrepared: config.weeklyDir,
    })

    logBackup('completed', {
      backupFile: archivePath,
      metadataFile: metaPath,
      size: formatBytes(sizeBytes),
      deletedBackups,
      strategy: backupResult.strategy,
    })
  } catch (error) {
    logBackupError('failed', {
      message: error instanceof Error ? error.message : String(error),
    })
    process.exitCode = 1
  } finally {
    await releaseLock().catch(() => undefined)
  }
}

main().catch((error) => {
  logBackupError('fatal', {
    message: error instanceof Error ? error.message : String(error),
  })
  process.exit(1)
})
