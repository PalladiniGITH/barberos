import fsPromises from 'node:fs/promises'
import path from 'node:path'
import process from 'node:process'
import {
  ensureDirectory,
  getBackupRuntimeConfig,
  parseCliArgs,
} from './lib/postgres-backup-utils.mjs'

const DEFAULT_CRON_OUTPUT = '/etc/cron.d/barbermain-postgres-backup'

const HELP_TEXT = `
Instala o cron diario de backup do PostgreSQL no host da VPS.

Uso:
  sudo node scripts/install-postgres-backup-cron.mjs
  sudo node scripts/install-postgres-backup-cron.mjs --output /etc/cron.d/barbermain-postgres-backup
  node scripts/install-postgres-backup-cron.mjs --print

Flags:
  --output caminho do arquivo cron
  --print  imprime o cron gerado sem gravar
  --help   mostra esta ajuda
`.trim()

function buildCronContent(config) {
  const scriptPath = path.join(config.projectRoot, 'scripts', 'postgres-backup.mjs')
  const command = `cd "${config.projectRoot}" && "${config.nodeBinary}" "${scriptPath}" >> "${config.logFile}" 2>&1`

  return [
    'SHELL=/bin/bash',
    'PATH=/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:/sbin:/bin',
    `CRON_TZ=${config.timezone}`,
    '',
    `${config.cronMinute} ${config.cronHour} * * * root ${command}`,
    '',
  ].join('\n')
}

async function main() {
  const { flags } = parseCliArgs(process.argv.slice(2))

  if (flags.has('help')) {
    console.log(HELP_TEXT)
    return
  }

  const config = getBackupRuntimeConfig()
  const outputPath = flags.get('output') && flags.get('output') !== true
    ? path.resolve(String(flags.get('output')))
    : DEFAULT_CRON_OUTPUT
  const shouldPrintOnly = flags.has('print')
  const cronContent = buildCronContent(config)

  if (shouldPrintOnly) {
    console.log(cronContent)
    return
  }

  if (process.platform !== 'linux') {
    throw new Error('A instalacao automatica do cron foi pensada para Linux/VPS. Use --print para gerar o conteudo.')
  }

  await ensureDirectory(config.backupRoot)
  await ensureDirectory(config.dailyDir)
  await ensureDirectory(config.weeklyDir)
  await ensureDirectory(config.logsDir)
  await ensureDirectory(path.dirname(outputPath))
  await fsPromises.writeFile(outputPath, cronContent, 'utf8')

  console.info('[db-backup-cron] installed', {
    outputPath,
    schedule: `${String(config.cronHour).padStart(2, '0')}:${String(config.cronMinute).padStart(2, '0')} ${config.timezone}`,
    logFile: config.logFile,
    backupDir: config.dailyDir,
    containerHint: config.container || config.containerHint || null,
    containerResolution: config.container
      ? 'explicita por POSTGRES_BACKUP_CONTAINER'
      : 'descoberta automatica em runtime pelo host do DATABASE_URL + Docker inspect',
  })
}

main().catch((error) => {
  console.error('[db-backup-cron] failed', {
    message: error instanceof Error ? error.message : String(error),
  })
  process.exit(1)
})
