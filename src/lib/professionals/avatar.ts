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

  if (trimmedValue.startsWith('/')) {
    return !trimmedValue.startsWith('//')
  }

  try {
    const parsed = new URL(trimmedValue)
    return parsed.protocol === 'http:' || parsed.protocol === 'https:'
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
