const BLOCKED_AVATAR_EXTENSION_PATTERN = /\.svg(?:$|[?#])/i
const BLOCKED_RELATIVE_SEGMENT_PATTERN = /(^|\/)\.\.(\/|$)|\\/

export function getProfessionalInitials(name: string) {
  const trimmedName = name.trim()

  if (!trimmedName) {
    return 'PR'
  }

  const parts = trimmedName.split(/\s+/).filter(Boolean)
  const initials = parts
    .slice(0, 2)
    .map((part) => part[0] ?? '')
    .join('')
    .toUpperCase()

  return initials || trimmedName.slice(0, 2).toUpperCase()
}

export function isProfessionalAvatarUrl(value: string) {
  const trimmedValue = value.trim()

  if (!trimmedValue) {
    return false
  }

  if (
    BLOCKED_AVATAR_EXTENSION_PATTERN.test(trimmedValue)
    || /^(?:javascript|data|file):/i.test(trimmedValue)
    || /[\u0000-\u001f\u007f]/.test(trimmedValue)
  ) {
    return false
  }

  if (trimmedValue.startsWith('/')) {
    if (
      trimmedValue.startsWith('//')
      || !trimmedValue.startsWith('/uploads/')
      || BLOCKED_RELATIVE_SEGMENT_PATTERN.test(trimmedValue)
    ) {
      return false
    }

    return true
  }

  try {
    const parsed = new URL(trimmedValue)
    return (
      (parsed.protocol === 'http:' || parsed.protocol === 'https:')
      && !BLOCKED_AVATAR_EXTENSION_PATTERN.test(parsed.pathname)
      && !BLOCKED_RELATIVE_SEGMENT_PATTERN.test(parsed.pathname)
    )
  } catch {
    return false
  }
}

export function normalizeProfessionalAvatarUrl(value: string | null | undefined) {
  if (typeof value !== 'string') {
    return null
  }

  const trimmedValue = value.trim()

  if (!trimmedValue) {
    return null
  }

  return isProfessionalAvatarUrl(trimmedValue) ? trimmedValue : null
}
