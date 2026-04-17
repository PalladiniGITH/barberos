export const OPERATIONAL_BLOCK_SOURCE_PREFIX = 'schedule:block:'
export const OPERATIONAL_BLOCK_SERVICE_NAME = 'Bloqueio Operacional'
export const OPERATIONAL_BLOCK_CUSTOMER_NAME = 'Bloqueio Operacional'

export function isOperationalBlockSourceReference(sourceReference?: string | null) {
  return Boolean(sourceReference?.startsWith(OPERATIONAL_BLOCK_SOURCE_PREFIX))
}

export function buildOperationalBlockSourceReference() {
  return `${OPERATIONAL_BLOCK_SOURCE_PREFIX}${Date.now()}`
}
