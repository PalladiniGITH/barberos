import 'server-only'

import { Prisma } from '@prisma/client'

export type ClientSerializable =
  | null
  | string
  | number
  | boolean
  | ClientSerializable[]
  | { [key: string]: ClientSerializable }

/**
 * Normaliza valores do Prisma para um formato seguro para Client Components.
 * Decimal vira number, Date vira ISO string e objetos aninhados viram plain objects.
 */
export function serializeForClient(value: unknown): ClientSerializable {
  if (value === null || value === undefined) {
    return null
  }

  if (
    typeof value === 'string'
    || typeof value === 'number'
    || typeof value === 'boolean'
  ) {
    return value
  }

  if (typeof value === 'bigint') {
    return Number(value)
  }

  if (value instanceof Date) {
    return value.toISOString()
  }

  if (value instanceof Prisma.Decimal) {
    return value.toNumber()
  }

  if (Array.isArray(value)) {
    return value.map((item) => serializeForClient(item))
  }

  if (typeof value === 'object') {
    const serialized: Record<string, ClientSerializable> = {}

    Object.entries(value).forEach(([key, nestedValue]) => {
      serialized[key] = serializeForClient(nestedValue)
    })

    return serialized
  }

  return String(value)
}
