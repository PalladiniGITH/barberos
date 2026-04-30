type SafeLogLevel = 'info' | 'warn' | 'error'

const SENSITIVE_KEY_PATTERN = /(secret|token|apikey|api_key|authorization|password|cookie|session|nextauth)/i
const PHONE_KEY_PATTERN = /(phone|whatsapp|number)/i
const EMAIL_KEY_PATTERN = /email/i
const TEXT_KEY_PATTERN = /(message|text|prompt|content|question|answer|body)/i
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f]/g

function trimText(value: string, maxLength = 180) {
  const cleanedValue = value.replace(CONTROL_CHARACTER_PATTERN, ' ').trim()

  if (cleanedValue.length <= maxLength) {
    return cleanedValue
  }

  return `${cleanedValue.slice(0, maxLength)}...`
}

export function maskPhone(value: string | null | undefined) {
  if (!value) {
    return value ?? null
  }

  const digits = value.replace(/\D/g, '')

  if (!digits) {
    return null
  }

  if (digits.length <= 4) {
    return digits
  }

  return `${digits.slice(0, Math.min(4, digits.length - 4))}***${digits.slice(-4)}`
}

export function maskEmail(value: string | null | undefined) {
  if (!value) {
    return value ?? null
  }

  const trimmedValue = value.trim()
  const [localPart, domainPart] = trimmedValue.split('@')

  if (!localPart || !domainPart) {
    return trimText(trimmedValue, 80)
  }

  const visiblePrefix = localPart.slice(0, Math.min(2, localPart.length))
  return `${visiblePrefix}***@${domainPart}`
}

function sanitizeTextValue(value: string) {
  return {
    length: value.length,
    preview: trimText(value, 80),
  }
}

export function sanitizeErrorForLogs(error: unknown) {
  if (error instanceof Error) {
    return {
      name: error.name,
      message: trimText(error.message, 240),
    }
  }

  return {
    name: 'UnknownError',
    message: trimText(String(error), 240),
  }
}

export function sanitizeForLogs(value: unknown, depth = 0): unknown {
  if (value === null || value === undefined) {
    return value ?? null
  }

  if (depth > 4) {
    return '[truncated]'
  }

  if (typeof value === 'number' || typeof value === 'boolean') {
    return value
  }

  if (typeof value === 'string') {
    return trimText(value)
  }

  if (Array.isArray(value)) {
    return value.slice(0, 10).map((item) => sanitizeForLogs(item, depth + 1))
  }

  if (value instanceof Error) {
    return sanitizeErrorForLogs(value)
  }

  if (typeof value !== 'object') {
    return trimText(String(value))
  }

  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([key, fieldValue]) => {
      if (SENSITIVE_KEY_PATTERN.test(key)) {
        return [key, '[redacted]']
      }

      if (PHONE_KEY_PATTERN.test(key)) {
        return [key, maskPhone(typeof fieldValue === 'string' ? fieldValue : String(fieldValue ?? ''))]
      }

      if (EMAIL_KEY_PATTERN.test(key)) {
        return [key, maskEmail(typeof fieldValue === 'string' ? fieldValue : String(fieldValue ?? ''))]
      }

      if (TEXT_KEY_PATTERN.test(key) && typeof fieldValue === 'string') {
        return [key, sanitizeTextValue(fieldValue)]
      }

      return [key, sanitizeForLogs(fieldValue, depth + 1)]
    })
  )
}

export function safeLog(level: SafeLogLevel, message: string, metadata?: unknown) {
  if (metadata === undefined) {
    console[level](message)
    return
  }

  console[level](message, sanitizeForLogs(metadata))
}
