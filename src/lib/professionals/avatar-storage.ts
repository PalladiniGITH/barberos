import 'server-only'

import path from 'node:path'
import { randomBytes } from 'node:crypto'
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises'
import {
  PROFESSIONAL_AVATAR_ALLOWED_MIME_TYPES,
  PROFESSIONAL_AVATAR_DEFAULT_MAX_FILE_SIZE_MB,
  professionalAvatarMaxFileSizeBytes,
  type ProfessionalAvatarAllowedMimeType,
  type ProfessionalAvatarExtension,
} from '@/lib/professionals/avatar-upload-policy'

const PROFESSIONAL_AVATAR_MIME_TO_EXTENSION: Record<
  ProfessionalAvatarAllowedMimeType,
  ProfessionalAvatarExtension
> = {
  'image/jpeg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
}

const SAFE_ID_SEGMENT_REGEX = /^[a-z0-9]+$/i
const SAFE_FILE_NAME_REGEX = /^[a-z0-9-]+\.(jpg|png|webp)$/i

export class ProfessionalAvatarUploadError extends Error {
  statusCode: number

  constructor(message: string, statusCode = 400) {
    super(message)
    this.name = 'ProfessionalAvatarUploadError'
    this.statusCode = statusCode
  }
}

export interface ProfessionalAvatarStorageConfig {
  driver: 'local'
  publicBaseUrl: string
  localDir: string
  maxFileSizeMb: number
  maxFileSizeBytes: number
}

function parsePositiveInteger(value: string | undefined, fallbackValue: number) {
  if (!value) {
    return fallbackValue
  }

  const parsed = Number.parseInt(value, 10)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallbackValue
}

function normalizePublicBaseUrl(value: string | undefined) {
  const trimmedValue = value?.trim()

  if (!trimmedValue) {
    return '/uploads'
  }

  if (/^https?:\/\//i.test(trimmedValue)) {
    return trimmedValue.replace(/\/+$/, '')
  }

  return `/${trimmedValue.replace(/^\/+/, '').replace(/\/+$/, '')}`
}

function resolveLocalDir(value: string | undefined) {
  const trimmedValue = value?.trim()

  if (!trimmedValue) {
    return path.resolve(process.cwd(), '.runtime', 'uploads')
  }

  return path.resolve(trimmedValue)
}

export function resolveProfessionalAvatarStorageConfig(
  env: NodeJS.ProcessEnv = process.env
): ProfessionalAvatarStorageConfig {
  const requestedDriver = env.UPLOAD_STORAGE_DRIVER?.trim()
  const driver = !requestedDriver || requestedDriver === 'local'
    ? 'local'
    : null

  if (!driver) {
    throw new ProfessionalAvatarUploadError(
      `Driver de upload "${requestedDriver}" ainda nao suportado para avatar de profissional.`,
      500
    )
  }

  const maxFileSizeMb = parsePositiveInteger(
    env.UPLOAD_MAX_FILE_SIZE_MB,
    PROFESSIONAL_AVATAR_DEFAULT_MAX_FILE_SIZE_MB
  )

  return {
    driver,
    publicBaseUrl: normalizePublicBaseUrl(env.UPLOAD_PUBLIC_BASE_URL),
    localDir: resolveLocalDir(env.UPLOAD_LOCAL_DIR),
    maxFileSizeMb,
    maxFileSizeBytes: professionalAvatarMaxFileSizeBytes(maxFileSizeMb),
  }
}

function ensureSafeSegment(value: string, label: string) {
  if (!SAFE_ID_SEGMENT_REGEX.test(value)) {
    throw new ProfessionalAvatarUploadError(`${label} invalido para caminho de avatar.`, 400)
  }
}

function normalizeRelativePath(relativePath: string) {
  return relativePath.replace(/\\/g, '/').replace(/^\/+/, '')
}

function ensurePathInsideRoot(rootDir: string, candidatePath: string) {
  const resolvedRootDir = path.resolve(rootDir)
  const resolvedCandidatePath = path.resolve(candidatePath)

  if (
    resolvedCandidatePath !== resolvedRootDir &&
    !resolvedCandidatePath.startsWith(`${resolvedRootDir}${path.sep}`)
  ) {
    throw new ProfessionalAvatarUploadError('Caminho de avatar fora do diretorio permitido.', 400)
  }

  return resolvedCandidatePath
}

export function getProfessionalAvatarExtensionFromMimeType(
  mimeType: string | null | undefined
) {
  return PROFESSIONAL_AVATAR_MIME_TO_EXTENSION[
    mimeType as ProfessionalAvatarAllowedMimeType
  ] ?? null
}

export function detectProfessionalAvatarFileExtension(buffer: Buffer) {
  if (
    buffer.length >= 8 &&
    buffer[0] === 0x89 &&
    buffer[1] === 0x50 &&
    buffer[2] === 0x4e &&
    buffer[3] === 0x47 &&
    buffer[4] === 0x0d &&
    buffer[5] === 0x0a &&
    buffer[6] === 0x1a &&
    buffer[7] === 0x0a
  ) {
    return 'png' satisfies ProfessionalAvatarExtension
  }

  if (
    buffer.length >= 3 &&
    buffer[0] === 0xff &&
    buffer[1] === 0xd8 &&
    buffer[2] === 0xff
  ) {
    return 'jpg' satisfies ProfessionalAvatarExtension
  }

  if (
    buffer.length >= 12 &&
    buffer.subarray(0, 4).toString('ascii') === 'RIFF' &&
    buffer.subarray(8, 12).toString('ascii') === 'WEBP'
  ) {
    return 'webp' satisfies ProfessionalAvatarExtension
  }

  return null
}

export function buildProfessionalAvatarRelativePath(input: {
  barbershopId: string
  professionalId: string
  extension: ProfessionalAvatarExtension
  randomToken?: string
}) {
  ensureSafeSegment(input.barbershopId, 'Tenant')
  ensureSafeSegment(input.professionalId, 'Profissional')

  const randomToken = input.randomToken?.trim() || randomBytes(8).toString('hex')
  const fileName = `${input.professionalId}-${randomToken}.${input.extension}`

  if (!SAFE_FILE_NAME_REGEX.test(fileName)) {
    throw new ProfessionalAvatarUploadError('Nome de arquivo de avatar invalido.', 500)
  }

  return `professionals/${input.barbershopId}/${fileName}`
}

export function buildProfessionalAvatarPublicUrl(
  relativePath: string,
  env: NodeJS.ProcessEnv = process.env
) {
  const { publicBaseUrl } = resolveProfessionalAvatarStorageConfig(env)
  const normalizedRelativePath = normalizeRelativePath(relativePath)

  if (/^https?:\/\//i.test(publicBaseUrl)) {
    return `${publicBaseUrl}/${normalizedRelativePath}`
  }

  return `${publicBaseUrl}/${normalizedRelativePath}`.replace(/\/{2,}/g, '/')
}

export function resolveProfessionalAvatarLocalFilePath(
  relativePath: string,
  env: NodeJS.ProcessEnv = process.env
) {
  const { localDir } = resolveProfessionalAvatarStorageConfig(env)
  const normalizedRelativePath = normalizeRelativePath(relativePath)
  const candidatePath = path.join(localDir, normalizedRelativePath)

  return ensurePathInsideRoot(localDir, candidatePath)
}

function getBaseUrlPathname(publicBaseUrl: string) {
  if (/^https?:\/\//i.test(publicBaseUrl)) {
    return new URL(publicBaseUrl).pathname.replace(/\/+$/, '')
  }

  return publicBaseUrl
}

export function extractProfessionalAvatarRelativePath(
  avatarUrl: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env
) {
  if (!avatarUrl) {
    return null
  }

  const { publicBaseUrl } = resolveProfessionalAvatarStorageConfig(env)
  const normalizedBasePath = getBaseUrlPathname(publicBaseUrl).replace(/\/+$/, '')
  const normalizedAvatarUrl = avatarUrl.trim()

  if (!normalizedAvatarUrl) {
    return null
  }

  if (/^https?:\/\//i.test(publicBaseUrl)) {
    if (!/^https?:\/\//i.test(normalizedAvatarUrl)) {
      return null
    }

    const baseUrl = new URL(publicBaseUrl)
    const candidateUrl = new URL(normalizedAvatarUrl)

    if (baseUrl.origin !== candidateUrl.origin) {
      return null
    }

    if (!candidateUrl.pathname.startsWith(`${normalizedBasePath}/`)) {
      return null
    }

    return candidateUrl.pathname
      .slice(normalizedBasePath.length + 1)
      .replace(/^\/+/, '')
  }

  if (!normalizedAvatarUrl.startsWith(`${normalizedBasePath}/`)) {
    return null
  }

  return normalizedAvatarUrl
    .slice(normalizedBasePath.length + 1)
    .replace(/^\/+/, '')
}

export function isProfessionalAvatarStoredLocally(
  avatarUrl: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env
) {
  return Boolean(extractProfessionalAvatarRelativePath(avatarUrl, env))
}

export async function deleteProfessionalAvatarFile(
  avatarUrl: string | null | undefined,
  env: NodeJS.ProcessEnv = process.env
) {
  const relativePath = extractProfessionalAvatarRelativePath(avatarUrl, env)

  if (!relativePath) {
    return false
  }

  const localFilePath = resolveProfessionalAvatarLocalFilePath(relativePath, env)

  try {
    await unlink(localFilePath)
    return true
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return false
    }

    throw error
  }
}

export async function storeProfessionalAvatarFile(input: {
  file: File
  barbershopId: string
  professionalId: string
  env?: NodeJS.ProcessEnv
}) {
  const env = input.env ?? process.env
  const config = resolveProfessionalAvatarStorageConfig(env)

  if (!PROFESSIONAL_AVATAR_ALLOWED_MIME_TYPES.includes(
    input.file.type as ProfessionalAvatarAllowedMimeType
  )) {
    throw new ProfessionalAvatarUploadError(
      'Envie apenas imagens JPG, PNG ou WEBP.',
      415
    )
  }

  if (input.file.size === 0) {
    throw new ProfessionalAvatarUploadError('O arquivo enviado esta vazio.', 400)
  }

  if (input.file.size > config.maxFileSizeBytes) {
    throw new ProfessionalAvatarUploadError(
      `A foto deve ter no maximo ${config.maxFileSizeMb}MB.`,
      413
    )
  }

  const fileBuffer = Buffer.from(await input.file.arrayBuffer())

  const detectedExtension = detectProfessionalAvatarFileExtension(fileBuffer)
  const mimeExtension = getProfessionalAvatarExtensionFromMimeType(input.file.type)

  if (!detectedExtension || !mimeExtension || detectedExtension !== mimeExtension) {
    throw new ProfessionalAvatarUploadError(
      'Nao foi possivel validar o tipo real da imagem enviada.',
      415
    )
  }

  let lastError: unknown

  for (let attempt = 0; attempt < 5; attempt += 1) {
    const relativePath = buildProfessionalAvatarRelativePath({
      barbershopId: input.barbershopId,
      professionalId: input.professionalId,
      extension: detectedExtension,
    })
    const localFilePath = resolveProfessionalAvatarLocalFilePath(relativePath, env)

    try {
      await mkdir(path.dirname(localFilePath), { recursive: true })
      await writeFile(localFilePath, fileBuffer, { flag: 'wx' })

      return {
        avatarUrl: buildProfessionalAvatarPublicUrl(relativePath, env),
        relativePath,
        localFilePath,
      }
    } catch (error) {
      lastError = error

      if ((error as NodeJS.ErrnoException).code !== 'EEXIST') {
        throw error
      }
    }
  }

  throw lastError ?? new ProfessionalAvatarUploadError(
    'Nao foi possivel gerar um nome seguro para a foto.',
    500
  )
}

export function buildProfessionalAvatarRelativePathFromParams(input: {
  barbershopId: string
  fileName: string
}) {
  ensureSafeSegment(input.barbershopId, 'Tenant')

  if (!SAFE_FILE_NAME_REGEX.test(input.fileName)) {
    throw new ProfessionalAvatarUploadError('Arquivo de avatar invalido.', 400)
  }

  return `professionals/${input.barbershopId}/${input.fileName}`
}

export function getProfessionalAvatarContentType(fileName: string) {
  const normalizedFileName = fileName.toLowerCase()

  if (normalizedFileName.endsWith('.png')) {
    return 'image/png'
  }

  if (normalizedFileName.endsWith('.webp')) {
    return 'image/webp'
  }

  if (normalizedFileName.endsWith('.jpg')) {
    return 'image/jpeg'
  }

  return null
}

export async function readProfessionalAvatarFile(input: {
  barbershopId: string
  fileName: string
  env?: NodeJS.ProcessEnv
}) {
  const relativePath = buildProfessionalAvatarRelativePathFromParams(input)
  const localFilePath = resolveProfessionalAvatarLocalFilePath(
    relativePath,
    input.env ?? process.env
  )
  const contentType = getProfessionalAvatarContentType(input.fileName)

  if (!contentType) {
    throw new ProfessionalAvatarUploadError('Tipo de arquivo de avatar invalido.', 400)
  }

  try {
    const buffer = await readFile(localFilePath)

    return {
      buffer,
      contentType,
    }
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') {
      return null
    }

    throw error
  }
}
