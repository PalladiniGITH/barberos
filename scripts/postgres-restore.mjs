import path from 'node:path'
import process from 'node:process'
import {
  countPublicTablesWithPsql,
  ensureDirectory,
  getBackupRuntimeConfig,
  logRestore,
  logRestoreError,
  parseCliArgs,
  requireFlag,
  resolveBackupStrategy,
  resolveDockerContainer,
  runCommand,
} from './lib/postgres-backup-utils.mjs'

const HELP_TEXT = `
Restore completo de um backup PostgreSQL do BarberMain.

Uso:
  node scripts/postgres-restore.mjs --file /var/backups/barbermain/postgres/daily/barberos_20260423-031500.dump --force
  node scripts/postgres-restore.mjs --file ./backup.dump --target-db barbermain_restore_test --drop-create --force

Flags:
  --file        arquivo .dump em formato custom do pg_dump
  --target-db   banco alvo; padrao = DATABASE_URL atual
  --drop-create recria o banco antes do restore
  --force       confirmacao obrigatoria para operacao destrutiva
  --help        mostra esta ajuda
`.trim()

function getRestoreConfig(flags) {
  const runtime = getBackupRuntimeConfig()
  const filePath = path.resolve(String(requireFlag(flags, 'file', 'Informe --file com o caminho do backup.')))
  const targetDatabase = flags.get('target-db') && flags.get('target-db') !== true
    ? String(flags.get('target-db'))
    : runtime.database.database
  const dropCreate = flags.has('drop-create')
  const force = flags.has('force')

  return {
    ...runtime,
    filePath,
    targetDatabase,
    dropCreate,
    force,
  }
}

async function validateBackupFile(filePath) {
  await ensureDirectory(path.dirname(filePath))
  const stats = await import('node:fs/promises').then((module) => module.stat(filePath))

  if (!stats.isFile()) {
    throw new Error(`Arquivo de backup invalido: ${filePath}`)
  }
}

async function runDockerRestore(config) {
  const archiveName = path.basename(config.filePath)
  const tempArchivePath = `/tmp/${archiveName}`
  const containerName = config.resolvedContainer
  const baseEnv = {
    PGPASSWORD: config.database.password,
  }

  const psqlRunner = (psqlArgs) => runCommand(config.dockerBinary, [
    'exec',
    '-e',
    `PGPASSWORD=${config.database.password}`,
    containerName,
    'psql',
    '-h',
    '127.0.0.1',
    '-p',
    config.database.port,
    '-U',
    config.database.username,
    '-d',
    config.targetDatabase,
    ...psqlArgs,
  ], { env: baseEnv })

  try {
    await runCommand(config.dockerBinary, ['cp', config.filePath, `${containerName}:${tempArchivePath}`])

    if (config.dropCreate) {
      await runCommand(config.dockerBinary, [
        'exec',
        '-e',
        `PGPASSWORD=${config.database.password}`,
        containerName,
        'dropdb',
        '-h',
        '127.0.0.1',
        '-p',
        config.database.port,
        '-U',
        config.database.username,
        '--if-exists',
        config.targetDatabase,
      ], { env: baseEnv }).catch(() => undefined)

      await runCommand(config.dockerBinary, [
        'exec',
        '-e',
        `PGPASSWORD=${config.database.password}`,
        containerName,
        'createdb',
        '-h',
        '127.0.0.1',
        '-p',
        config.database.port,
        '-U',
        config.database.username,
        config.targetDatabase,
      ], { env: baseEnv })
    }

    await runCommand(config.dockerBinary, [
      'exec',
      '-e',
      `PGPASSWORD=${config.database.password}`,
      containerName,
      'pg_restore',
      '-h',
      '127.0.0.1',
      '-p',
      config.database.port,
      '-U',
      config.database.username,
      '-d',
      config.targetDatabase,
      '--clean',
      '--if-exists',
      '--no-owner',
      '--no-privileges',
      tempArchivePath,
    ], { env: baseEnv })

    const publicTableCount = await countPublicTablesWithPsql(psqlRunner, 'restore')

    return {
      strategy: 'docker-exec',
      publicTableCount,
    }
  } finally {
    await runCommand(config.dockerBinary, [
      'exec',
      containerName,
      'rm',
      '-f',
      tempArchivePath,
    ]).catch(() => undefined)
  }
}

async function runLocalRestore(config) {
  const baseEnv = {
    PGPASSWORD: config.database.password,
  }

  if (config.dropCreate) {
    await runCommand('dropdb', [
      '-h',
      config.database.host,
      '-p',
      config.database.port,
      '-U',
      config.database.username,
      '--if-exists',
      config.targetDatabase,
    ], { env: baseEnv }).catch(() => undefined)

    await runCommand('createdb', [
      '-h',
      config.database.host,
      '-p',
      config.database.port,
      '-U',
      config.database.username,
      config.targetDatabase,
    ], { env: baseEnv })
  }

  await runCommand('pg_restore', [
    '-h',
    config.database.host,
    '-p',
    config.database.port,
    '-U',
    config.database.username,
    '-d',
    config.targetDatabase,
    '--clean',
    '--if-exists',
    '--no-owner',
    '--no-privileges',
    config.filePath,
  ], { env: baseEnv })

  const psqlRunner = (psqlArgs) => runCommand('psql', [
    '-h',
    config.database.host,
    '-p',
    config.database.port,
    '-U',
    config.database.username,
    '-d',
    config.targetDatabase,
    ...psqlArgs,
  ], { env: baseEnv })

  const publicTableCount = await countPublicTablesWithPsql(psqlRunner, 'restore')

  return {
    strategy: 'local',
    publicTableCount,
  }
}

async function main() {
  const { flags } = parseCliArgs(process.argv.slice(2))

  if (flags.has('help')) {
    console.log(HELP_TEXT)
    return
  }

  const config = getRestoreConfig(flags)

  if (!config.force) {
    throw new Error('Restore bloqueado por seguranca. Use --force quando tiver certeza.')
  }

  await validateBackupFile(config.filePath)

  const strategy = await resolveBackupStrategy(config)
  const dockerTarget = strategy === 'docker-exec'
    ? await resolveDockerContainer(config, { required: true })
    : null

  logRestore('starting', {
    backupFile: config.filePath,
    targetDatabase: config.targetDatabase,
    dropCreate: config.dropCreate,
    strategy,
    container: dockerTarget?.containerName ?? null,
    containerResolution: dockerTarget?.source ?? null,
    containerHint: config.container || config.containerHint || null,
  })

  const restoreResult = strategy === 'docker-exec'
    ? await runDockerRestore(config)
    : await runLocalRestore(config)

  logRestore('completed', {
    backupFile: config.filePath,
    targetDatabase: config.targetDatabase,
    dropCreate: config.dropCreate,
    strategy: restoreResult.strategy,
    publicTableCount: restoreResult.publicTableCount,
  })
}

main().catch((error) => {
  logRestoreError('failed', {
    message: error instanceof Error ? error.message : String(error),
  })
  process.exit(1)
})
