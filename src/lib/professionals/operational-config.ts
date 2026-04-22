export type SupportedCustomerType = 'SUBSCRIPTION' | 'WALK_IN'
export type ProfessionalAttendanceScope = 'BOTH' | 'SUBSCRIPTION_ONLY' | 'WALK_IN_ONLY'
export type ProfessionalServicePriceCategory = 'HAIRCUT' | 'BEARD' | 'COMBO' | 'OTHER'

export interface ProfessionalOperationalConfig {
  commissionRate: number | null
  haircutPrice: number | null
  beardPrice: number | null
  comboPrice: number | null
  acceptsWalkIn: boolean
  acceptsSubscription: boolean
}

type NumericLike = number | string | { valueOf(): unknown } | null | undefined

type ProfessionalOperationalConfigLike = {
  commissionRate?: NumericLike
  haircutPrice?: NumericLike
  beardPrice?: NumericLike
  comboPrice?: NumericLike
  acceptsWalkIn?: boolean | null
  acceptsSubscription?: boolean | null
}

export const PROFESSIONAL_ATTENDANCE_SCOPE_LABELS: Record<ProfessionalAttendanceScope, string> = {
  BOTH: 'Assinatura e avulso',
  SUBSCRIPTION_ONLY: 'Somente assinatura',
  WALK_IN_ONLY: 'Somente avulso',
}

function normalizeText(value?: string | null) {
  return (value ?? '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function roundCurrency(value: number) {
  return Math.round(value * 100) / 100
}

function normalizeOptionalNumber(value: NumericLike) {
  if (value === null || value === undefined || value === '') {
    return null
  }

  const normalized = typeof value === 'number' ? value : Number(value)
  return Number.isFinite(normalized) ? normalized : null
}

export function normalizeProfessionalOperationalConfig(
  input: ProfessionalOperationalConfigLike | null | undefined
): ProfessionalOperationalConfig | null {
  if (!input) {
    return null
  }

  return {
    commissionRate: normalizeOptionalNumber(input.commissionRate),
    haircutPrice: normalizeOptionalNumber(input.haircutPrice),
    beardPrice: normalizeOptionalNumber(input.beardPrice),
    comboPrice: normalizeOptionalNumber(input.comboPrice),
    acceptsWalkIn: input.acceptsWalkIn !== false,
    acceptsSubscription: input.acceptsSubscription !== false,
  }
}

export function resolveProfessionalAttendanceScope(input: {
  acceptsSubscription?: boolean | null
  acceptsWalkIn?: boolean | null
}): ProfessionalAttendanceScope {
  const acceptsSubscription = input.acceptsSubscription !== false
  const acceptsWalkIn = input.acceptsWalkIn !== false

  if (acceptsSubscription && acceptsWalkIn) {
    return 'BOTH'
  }

  if (acceptsSubscription) {
    return 'SUBSCRIPTION_ONLY'
  }

  return 'WALK_IN_ONLY'
}

export function attendanceScopeToFlags(scope: ProfessionalAttendanceScope) {
  switch (scope) {
    case 'SUBSCRIPTION_ONLY':
      return {
        acceptsSubscription: true,
        acceptsWalkIn: false,
      }
    case 'WALK_IN_ONLY':
      return {
        acceptsSubscription: false,
        acceptsWalkIn: true,
      }
    case 'BOTH':
    default:
      return {
        acceptsSubscription: true,
        acceptsWalkIn: true,
      }
  }
}

export function resolveProfessionalServicePriceCategory(serviceName?: string | null): ProfessionalServicePriceCategory {
  const normalizedServiceName = normalizeText(serviceName)
  const hasHaircutKeyword = normalizedServiceName.includes('corte') || normalizedServiceName.includes('degrad')
  const hasBeardKeyword = normalizedServiceName.includes('barba')

  if (normalizedServiceName.includes('combo') || (hasHaircutKeyword && hasBeardKeyword)) {
    return 'COMBO'
  }

  if (hasBeardKeyword) {
    return 'BEARD'
  }

  if (hasHaircutKeyword) {
    return 'HAIRCUT'
  }

  return 'OTHER'
}

export function resolveProfessionalServicePrice(input: {
  serviceName: string
  basePrice: number
  professional: Pick<ProfessionalOperationalConfig, 'haircutPrice' | 'beardPrice' | 'comboPrice'> | null | undefined
}) {
  const category = resolveProfessionalServicePriceCategory(input.serviceName)
  const override = category === 'HAIRCUT'
    ? input.professional?.haircutPrice
    : category === 'BEARD'
      ? input.professional?.beardPrice
      : category === 'COMBO'
        ? input.professional?.comboPrice
        : null

  return {
    category,
    price: roundCurrency(override && override > 0 ? override : input.basePrice),
  }
}

export function resolveProfessionalCommissionRatePercent(input: {
  professionalRate?: number | null
  fallbackRate?: number | null
}) {
  if (typeof input.professionalRate === 'number' && input.professionalRate > 0) {
    return input.professionalRate
  }

  if (typeof input.fallbackRate === 'number' && input.fallbackRate > 0) {
    return input.fallbackRate
  }

  return 40
}

export function resolveProfessionalCommissionRateRatio(input: {
  professionalRate?: number | null
  fallbackRate?: number | null
}) {
  return resolveProfessionalCommissionRatePercent(input) / 100
}

export function canProfessionalHandleCustomerType(input: {
  customerType: SupportedCustomerType
  professional: Pick<ProfessionalOperationalConfig, 'acceptsSubscription' | 'acceptsWalkIn'> | null | undefined
}) {
  if (!input.professional) {
    return true
  }

  if (input.customerType === 'SUBSCRIPTION') {
    return input.professional.acceptsSubscription !== false
  }

  return input.professional.acceptsWalkIn !== false
}
