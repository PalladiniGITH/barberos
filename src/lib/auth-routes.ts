export const AUTH_ENTRY_PATH = '/'
export const AUTHENTICATED_HOME_PATH = '/dashboard'
const NEXTAUTH_SIGNIN_PATH = '/api/auth/signin'

export function normalizeCallbackPath(value?: string | null) {
  if (typeof value !== 'string') {
    return AUTHENTICATED_HOME_PATH
  }

  const normalized = value.trim()
  if (!normalized || !normalized.startsWith('/') || normalized.startsWith('//')) {
    return AUTHENTICATED_HOME_PATH
  }

  return normalized
}

export function buildAuthEntryHref(callbackPath?: string | null) {
  const callbackUrl = normalizeCallbackPath(callbackPath)

  if (callbackUrl === AUTHENTICATED_HOME_PATH) {
    return AUTH_ENTRY_PATH
  }

  const params = new URLSearchParams({ callbackUrl })
  return `${AUTH_ENTRY_PATH}?${params.toString()}`
}

export function buildNextAuthSignInHref(input?: {
  callbackPath?: string | null
  error?: string | null
}) {
  const params = new URLSearchParams()
  params.set('callbackUrl', normalizeCallbackPath(input?.callbackPath))

  if (input?.error) {
    params.set('error', input.error)
  }

  return `${NEXTAUTH_SIGNIN_PATH}?${params.toString()}`
}
