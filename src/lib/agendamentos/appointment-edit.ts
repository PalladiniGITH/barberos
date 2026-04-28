export interface AppointmentRescheduleComparable {
  date: string
  time: string
  professionalId: string | null | undefined
}

export interface AppointmentMoveComparable {
  dateIso: string
  startMinutes: number
  professionalId: string | null | undefined
}

export function isAppointmentRescheduled(
  original: AppointmentRescheduleComparable,
  current: AppointmentRescheduleComparable,
) {
  return (
    original.date !== current.date
    || original.time !== current.time
    || (original.professionalId ?? null) !== (current.professionalId ?? null)
  )
}

export function getAppointmentSaveSuccessMessage(input: {
  isEdit: boolean
  originalAppointment?: AppointmentRescheduleComparable | null
  currentAppointment: AppointmentRescheduleComparable
}) {
  if (!input.isEdit || !input.originalAppointment) {
    return 'Agendamento criado.'
  }

  return isAppointmentRescheduled(input.originalAppointment, input.currentAppointment)
    ? 'Agendamento remarcado.'
    : 'Agendamento atualizado.'
}

export function shouldCommitAppointmentMove(
  original: AppointmentMoveComparable,
  preview: AppointmentMoveComparable,
) {
  return (
    original.dateIso !== preview.dateIso
    || original.startMinutes !== preview.startMinutes
    || (original.professionalId ?? null) !== (preview.professionalId ?? null)
  )
}
