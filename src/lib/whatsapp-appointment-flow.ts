import 'server-only'

import type { Prisma } from '@prisma/client'
import type { WhatsAppManagedAppointment } from '@/lib/agendamentos/whatsapp-appointment-operations'
import type { WhatsAppBookingSlot } from '@/lib/agendamentos/whatsapp-booking'
import type { NamedOptionWithId } from '@/lib/whatsapp-option-resolution'
import { formatDayLabelFromIsoDate, resolveBusinessTimezone } from '@/lib/timezone'

export type WhatsAppOperationalFlowKind = 'cancel' | 'reschedule' | 'reminder'

export interface WhatsAppOperationalDraft {
  kind: WhatsAppOperationalFlowKind
  appointments: WhatsAppManagedAppointment[]
  selectedAppointmentId: string | null
  offeredSlots: WhatsAppBookingSlot[]
  selectedSlot: WhatsAppBookingSlot | null
  pendingProfessionalOptions: NamedOptionWithId[]
  requestedDateIso: string | null
  requestedTimeLabel: string | null
  selectedProfessionalId: string | null
  selectedProfessionalName: string | null
  allowAnyProfessional: boolean
  triggeredByReminder: boolean
  reminderPromptedAtIso: string | null
}

function normalizeText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function normalizeIntentPhrase(value: string) {
  return normalizeText(value).replace(/[^a-z0-9]+/g, ' ').replace(/\s+/g, ' ').trim()
}

function isManagedAppointment(value: unknown): value is WhatsAppManagedAppointment {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const appointment = value as Record<string, unknown>

  return (
    typeof appointment.id === 'string'
    && typeof appointment.barbershopId === 'string'
    && typeof appointment.customerId === 'string'
    && typeof appointment.serviceId === 'string'
    && typeof appointment.serviceName === 'string'
    && typeof appointment.professionalId === 'string'
    && typeof appointment.professionalName === 'string'
    && typeof appointment.status === 'string'
    && typeof appointment.startAtIso === 'string'
    && typeof appointment.endAtIso === 'string'
    && typeof appointment.dateIso === 'string'
    && typeof appointment.dateLabel === 'string'
    && typeof appointment.timeLabel === 'string'
  )
}

function isBookingSlot(value: unknown): value is WhatsAppBookingSlot {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const slot = value as Record<string, unknown>

  return (
    typeof slot.key === 'string'
    && typeof slot.professionalId === 'string'
    && typeof slot.professionalName === 'string'
    && typeof slot.dateIso === 'string'
    && typeof slot.timeLabel === 'string'
    && typeof slot.startAtIso === 'string'
    && typeof slot.endAtIso === 'string'
  )
}

function isNamedOptionWithId(value: unknown): value is NamedOptionWithId {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false
  }

  const option = value as Record<string, unknown>

  return typeof option.id === 'string' && typeof option.name === 'string'
}

export function buildEmptyOperationalDraft(
  kind: WhatsAppOperationalFlowKind,
  appointments: WhatsAppManagedAppointment[] = [],
): WhatsAppOperationalDraft {
  return {
    kind,
    appointments,
    selectedAppointmentId: appointments.length === 1 ? appointments[0].id : null,
    offeredSlots: [],
    selectedSlot: null,
    pendingProfessionalOptions: [],
    requestedDateIso: null,
    requestedTimeLabel: null,
    selectedProfessionalId: appointments.length === 1 ? appointments[0].professionalId : null,
    selectedProfessionalName: appointments.length === 1 ? appointments[0].professionalName : null,
    allowAnyProfessional: false,
    triggeredByReminder: false,
    reminderPromptedAtIso: null,
  }
}

export function parseOperationalDraft(raw: Prisma.JsonValue | null) {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) {
    return null
  }

  const candidate = raw as Record<string, unknown>
  const kind = candidate.kind

  if (kind !== 'cancel' && kind !== 'reschedule' && kind !== 'reminder') {
    return null
  }

  const appointments = Array.isArray(candidate.appointments)
    ? candidate.appointments.filter(isManagedAppointment)
    : []
  const offeredSlots = Array.isArray(candidate.offeredSlots)
    ? candidate.offeredSlots.filter(isBookingSlot)
    : []
  const selectedSlot = isBookingSlot(candidate.selectedSlot) ? candidate.selectedSlot : null
  const pendingProfessionalOptions = Array.isArray(candidate.pendingProfessionalOptions)
    ? candidate.pendingProfessionalOptions.filter(isNamedOptionWithId)
    : []

  return {
    kind,
    appointments,
    selectedAppointmentId: typeof candidate.selectedAppointmentId === 'string'
      ? candidate.selectedAppointmentId
      : null,
    offeredSlots,
    selectedSlot,
    pendingProfessionalOptions,
    requestedDateIso: typeof candidate.requestedDateIso === 'string'
      ? candidate.requestedDateIso
      : null,
    requestedTimeLabel: typeof candidate.requestedTimeLabel === 'string'
      ? candidate.requestedTimeLabel
      : null,
    selectedProfessionalId: typeof candidate.selectedProfessionalId === 'string'
      ? candidate.selectedProfessionalId
      : null,
    selectedProfessionalName: typeof candidate.selectedProfessionalName === 'string'
      ? candidate.selectedProfessionalName
      : null,
    allowAnyProfessional: candidate.allowAnyProfessional === true,
    triggeredByReminder: candidate.triggeredByReminder === true,
    reminderPromptedAtIso: typeof candidate.reminderPromptedAtIso === 'string'
      ? candidate.reminderPromptedAtIso
      : null,
  } satisfies WhatsAppOperationalDraft
}

export function selectOperationalAppointment(draft: WhatsAppOperationalDraft) {
  if (!draft.selectedAppointmentId) {
    return null
  }

  return draft.appointments.find((appointment) => appointment.id === draft.selectedAppointmentId) ?? null
}

export function isCancellationIntentMessage(message: string) {
  const normalized = normalizeText(message)
  return /\b(cancelar|cancela|cancelamento|desmarca|desmarcar|nao vou conseguir ir|nao vou conseguir comparecer)\b/.test(normalized)
}

export function isRescheduleIntentMessage(message: string) {
  const normalized = normalizeText(message)
  return /\b(remarcar|remarca|reagendar|reagenda|trocar meu horario|trocar meu horario|trocar horario|mudar meu horario|mudar meu agendamento|muda para|troca pra|queria outro horario|outro horario)\b/.test(normalized)
}

export function isNegativeOperationalResponse(message: string) {
  const normalized = normalizeIntentPhrase(message)
  return [
    'nao',
    'nao quero',
    'nao precisa',
    'deixa',
    'deixa pra la',
    'deixa quieto',
    'deixa assim',
    'parei',
  ].includes(normalized)
}

export function isExplicitCancellationConfirmationMessage(message: string) {
  const normalized = normalizeIntentPhrase(message)

  return [
    'sim',
    'confirmo',
    'confirmo cancelamento',
    'confirma cancelamento',
    'pode cancelar',
    'sim pode cancelar',
    'cancelar',
    'quero cancelar',
  ].includes(normalized)
}

export function isExplicitRescheduleConfirmationMessage(message: string) {
  const normalized = normalizeIntentPhrase(message)

  return [
    'sim',
    'confirmo',
    'confirmar',
    'pode remarcar',
    'sim pode remarcar',
    'pode marcar',
    'sim pode marcar',
    'quero remarcar',
  ].includes(normalized)
}

export function parseOperationalSelectionNumber(message: string, maxOptions: number) {
  const normalized = normalizeIntentPhrase(message)
  const match = normalized.match(/(?:^|\s)([1-9])(?:\s|$)/)

  if (!match) {
    return null
  }

  const selection = Number.parseInt(match[1], 10)

  if (!Number.isFinite(selection) || selection < 1 || selection > maxOptions) {
    return null
  }

  return selection
}

function formatAppointmentListLine(appointment: WhatsAppManagedAppointment) {
  return `${appointment.dateLabel} as ${appointment.timeLabel} - ${appointment.serviceName} com ${appointment.professionalName}`
}

export function buildNoFutureAppointmentMessage() {
  return 'Nao encontrei um agendamento futuro vinculado a este numero. Se estiver usando outro telefone, me envie seu nome completo ou o horario que deseja ajustar.'
}

export function buildCancellationSelectionMessage(appointments: WhatsAppManagedAppointment[]) {
  return [
    'Encontrei mais de um agendamento futuro:',
    '',
    ...appointments.map((appointment, index) => `${index + 1}. ${formatAppointmentListLine(appointment)}`),
    '',
    'Qual deles voce quer cancelar?',
  ].join('\n')
}

export function buildCancellationConfirmationMessage(appointment: WhatsAppManagedAppointment) {
  return [
    'Encontrei este agendamento:',
    '',
    `Data: ${appointment.dateLabel}`,
    `Horario: ${appointment.timeLabel}`,
    `Servico: ${appointment.serviceName}`,
    `Barbeiro: ${appointment.professionalName}`,
    '',
    'Quer confirmar o cancelamento?',
  ].join('\n')
}

export function buildCancellationStrictConfirmationMessage() {
  return 'Para cancelar, me responda: pode cancelar.'
}

export function buildCancellationSuccessMessage() {
  return [
    'Pronto, seu horario foi cancelado.',
    '',
    'Se quiser marcar outro horario, e so me chamar por aqui.',
  ].join('\n')
}

export function buildRescheduleSelectionMessage(appointments: WhatsAppManagedAppointment[]) {
  return [
    'Encontrei mais de um agendamento futuro:',
    '',
    ...appointments.map((appointment, index) => `${index + 1}. ${formatAppointmentListLine(appointment)}`),
    '',
    'Qual deles voce quer remarcar?',
  ].join('\n')
}

export function buildReschedulePromptMessage(appointment: WhatsAppManagedAppointment) {
  return [
    'Encontrei seu agendamento atual:',
    '',
    `Data: ${appointment.dateLabel}`,
    `Horario: ${appointment.timeLabel}`,
    `Servico: ${appointment.serviceName}`,
    `Barbeiro: ${appointment.professionalName}`,
    '',
    'Para qual dia e horario voce quer remarcar?',
  ].join('\n')
}

export function buildRescheduleConfirmationMessage(input: {
  appointment: WhatsAppManagedAppointment
  slot: WhatsAppBookingSlot
  timezone: string
}) {
  const timezone = resolveBusinessTimezone(input.timezone)

  return [
    'Posso remarcar para:',
    '',
    `Data: ${formatDayLabelFromIsoDate(input.slot.dateIso, timezone)}`,
    `Horario: ${input.slot.timeLabel}`,
    `Servico: ${input.appointment.serviceName}`,
    `Barbeiro: ${input.slot.professionalName}`,
    '',
    'Quer confirmar a remarcacao?',
  ].join('\n')
}

export function buildRescheduleStrictConfirmationMessage() {
  return 'Para remarcar, me responda com uma confirmacao clara, por exemplo: pode remarcar.'
}

export function buildRescheduleProfessionalChoiceMessage(input: {
  timeLabel: string
  professionals: NamedOptionWithId[]
}) {
  return [
    `Tenho ${input.timeLabel} disponivel com mais de um barbeiro:`,
    '',
    ...input.professionals.map((professional, index) => `${index + 1}. ${professional.name}`),
    '',
    'Qual voce prefere?',
  ].join('\n')
}

export function buildRescheduleProfessionalUnavailableMessage(input: {
  professionalName: string
  dateIso: string
  timeLabel: string
  timezone: string
}) {
  const timezone = resolveBusinessTimezone(input.timezone)
  const dayLabel = formatDayLabelFromIsoDate(input.dateIso, timezone).toLowerCase()

  return `${input.professionalName} nao esta disponivel ${dayLabel}, as ${input.timeLabel}. Posso procurar outros horarios com ele?`
}

export function buildRescheduleSuccessMessage(input: {
  appointment: WhatsAppManagedAppointment
  slot: WhatsAppBookingSlot
  timezone: string
}) {
  const timezone = resolveBusinessTimezone(input.timezone)

  return [
    'Pronto, seu horario foi remarcado.',
    '',
    'Novo horario:',
    `Data: ${formatDayLabelFromIsoDate(input.slot.dateIso, timezone)}`,
    `Horario: ${input.slot.timeLabel}`,
    `Servico: ${input.appointment.serviceName}`,
    `Barbeiro: ${input.slot.professionalName}`,
  ].join('\n')
}

export function buildReminderResponseClarificationMessage() {
  return 'Para confirmar, responda 1. Para remarcar, responda 2. Para cancelar, responda 3.'
}

export function parseReminderResponseAction(message: string) {
  const normalized = normalizeIntentPhrase(message)

  if (['1', 'confirmo', 'sim', 'presenca confirmada', 'confirmar presenca'].includes(normalized)) {
    return 'confirm'
  }

  if (['2', 'remarcar', 'quero remarcar', 'reagendar', 'quero reagendar'].includes(normalized)) {
    return 'reschedule'
  }

  if (['3', 'cancelar', 'quero cancelar', 'cancelamento'].includes(normalized)) {
    return 'cancel'
  }

  if (['ok', 'blz', 'pode', 'isso', 'acho que sim'].includes(normalized)) {
    return 'ambiguous'
  }

  return 'none'
}

export const __testing = {
  buildCancellationConfirmationMessage,
  buildCancellationSelectionMessage,
  buildCancellationStrictConfirmationMessage,
  buildEmptyOperationalDraft,
  buildNoFutureAppointmentMessage,
  buildReminderResponseClarificationMessage,
  buildRescheduleConfirmationMessage,
  buildRescheduleProfessionalChoiceMessage,
  buildRescheduleProfessionalUnavailableMessage,
  buildReschedulePromptMessage,
  buildRescheduleSelectionMessage,
  buildRescheduleStrictConfirmationMessage,
  isCancellationIntentMessage,
  isExplicitCancellationConfirmationMessage,
  isExplicitRescheduleConfirmationMessage,
  isNegativeOperationalResponse,
  isRescheduleIntentMessage,
  parseOperationalDraft,
  parseOperationalSelectionNumber,
  parseReminderResponseAction,
  selectOperationalAppointment,
}
