export const PROFESSIONAL_AVATAR_ALLOWED_MIME_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
] as const

export type ProfessionalAvatarAllowedMimeType =
  (typeof PROFESSIONAL_AVATAR_ALLOWED_MIME_TYPES)[number]

export const PROFESSIONAL_AVATAR_ALLOWED_EXTENSIONS = [
  'jpg',
  'png',
  'webp',
] as const

export type ProfessionalAvatarExtension =
  (typeof PROFESSIONAL_AVATAR_ALLOWED_EXTENSIONS)[number]

export const PROFESSIONAL_AVATAR_DEFAULT_MAX_FILE_SIZE_MB = 3

export function professionalAvatarMaxFileSizeBytes(maxFileSizeMb: number) {
  return maxFileSizeMb * 1024 * 1024
}

