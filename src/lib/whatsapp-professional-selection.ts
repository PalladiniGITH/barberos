import 'server-only'

import { formatDayLabelFromIsoDate } from '@/lib/timezone'

export type ProfessionalSelectionReason =
  | 'only_available_professional'
  | 'customer_preferred_professional'
  | 'recent_booking_professional'
  | 'explicit_customer_choice'
  | 'any_professional_requested'
  | 'first_available_fallback'

const PROFESSIONAL_SELECTION_REASONS = new Set<ProfessionalSelectionReason>([
  'only_available_professional',
  'customer_preferred_professional',
  'recent_booking_professional',
  'explicit_customer_choice',
  'any_professional_requested',
  'first_available_fallback',
])

function normalizeText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

export function parseProfessionalSelectionReason(value: unknown): ProfessionalSelectionReason | null {
  return typeof value === 'string' && PROFESSIONAL_SELECTION_REASONS.has(value as ProfessionalSelectionReason)
    ? value as ProfessionalSelectionReason
    : null
}

export function inferProfessionalSelectionReasonFromContextualSource(
  source: 'recent_booking' | 'preferred_history' | null | undefined
): ProfessionalSelectionReason | null {
  if (source === 'recent_booking') {
    return 'recent_booking_professional'
  }

  if (source === 'preferred_history') {
    return 'customer_preferred_professional'
  }

  return null
}

export function isProfessionalSelectionWhyQuestion(message: string) {
  const normalized = normalizeText(message)

  return /\b(por que|porque|pq)\b/.test(normalized)
}

export function buildProfessionalSelectionExplanation(input: {
  professionalName: string
  reason: ProfessionalSelectionReason | null
  requestedDateIso?: string | null
  requestedTimeLabel?: string | null
  timezone?: string | null
}) {
  const normalizedTime = input.requestedTimeLabel?.includes(':') ? input.requestedTimeLabel : null
  const dayLabel = input.requestedDateIso && input.timezone
    ? formatDayLabelFromIsoDate(input.requestedDateIso, input.timezone).toLowerCase()
    : null

  if (input.reason === 'customer_preferred_professional') {
    return `Sugeri o ${input.professionalName} porque ele aparece como seu barbeiro preferencial. Mas posso trocar se voce preferir outro barbeiro.`
  }

  if (input.reason === 'recent_booking_professional') {
    return `Sugeri o ${input.professionalName} porque ele aparece no seu atendimento mais recente. Mas posso trocar se voce preferir outro barbeiro.`
  }

  if (input.reason === 'only_available_professional') {
    if (normalizedTime) {
      return dayLabel
        ? `Porque ${dayLabel}, as ${normalizedTime}, apenas o ${input.professionalName} esta disponivel. Se quiser, eu posso procurar outro horario com ele ou com outro barbeiro.`
        : `Porque as ${normalizedTime} apenas o ${input.professionalName} esta disponivel. Se quiser, eu posso procurar outro horario com ele ou com outro barbeiro.`
    }

    return `Escolhi o ${input.professionalName} porque ele e o unico disponivel nessa combinacao. Se preferir, eu posso procurar outro horario com outro barbeiro.`
  }

  if (input.reason === 'any_professional_requested') {
    return `Escolhi o ${input.professionalName} porque voce disse que poderia ser qualquer barbeiro. Se preferir, eu posso trocar.`
  }

  if (input.reason === 'explicit_customer_choice') {
    return `Estou com o ${input.professionalName} porque foi o barbeiro escolhido nesta conversa. Se quiser, eu posso trocar.`
  }

  return `Eu trouxe o ${input.professionalName} como uma opcao disponivel, mas posso trocar se voce preferir outro barbeiro.`
}
