export const SCHEDULE_GRID_STEP_MINUTES = 15

export function timeLabelToMinutes(timeLabel: string) {
  const match = /^(\d{2}):(\d{2})$/.exec(timeLabel)

  if (!match) {
    return 0
  }

  const [, hoursRaw, minutesRaw] = match
  return Number(hoursRaw) * 60 + Number(minutesRaw)
}

export function minutesToTimeLabel(totalMinutes: number) {
  const hours = Math.floor(totalMinutes / 60)
  const minutes = totalMinutes % 60
  return `${String(hours).padStart(2, '0')}:${String(minutes).padStart(2, '0')}`
}

export function clampMinutes(value: number, min: number, max: number) {
  return Math.max(min, Math.min(max, value))
}

export function roundMinutesToStep(value: number, step = SCHEDULE_GRID_STEP_MINUTES) {
  return Math.round(value / step) * step
}

export function floorMinutesToStep(value: number, step = SCHEDULE_GRID_STEP_MINUTES) {
  return Math.floor(value / step) * step
}

export function ceilMinutesToStep(value: number, step = SCHEDULE_GRID_STEP_MINUTES) {
  return Math.ceil(value / step) * step
}

export function normalizeSelectionRange(input: {
  anchorMinutes: number
  currentMinutes: number
  dayStartMinutes: number
  dayEndMinutes: number
  minimumDuration?: number
}) {
  const minimumDuration = input.minimumDuration ?? SCHEDULE_GRID_STEP_MINUTES
  const start = Math.min(input.anchorMinutes, input.currentMinutes)
  const end = Math.max(input.anchorMinutes, input.currentMinutes)

  const normalizedStart = clampMinutes(
    floorMinutesToStep(start, SCHEDULE_GRID_STEP_MINUTES),
    input.dayStartMinutes,
    input.dayEndMinutes - minimumDuration
  )

  const normalizedEnd = clampMinutes(
    ceilMinutesToStep(Math.max(end, normalizedStart + minimumDuration), SCHEDULE_GRID_STEP_MINUTES),
    normalizedStart + minimumDuration,
    input.dayEndMinutes
  )

  return {
    startMinutes: normalizedStart,
    endMinutes: normalizedEnd,
    durationMinutes: normalizedEnd - normalizedStart,
  }
}

export function intervalsOverlap(input: {
  startMinutes: number
  endMinutes: number
  compareStartMinutes: number
  compareEndMinutes: number
}) {
  return input.startMinutes < input.compareEndMinutes && input.endMinutes > input.compareStartMinutes
}

export function buildSelectionFromPoint(input: {
  minutes: number
  dayStartMinutes: number
  dayEndMinutes: number
  defaultDuration?: number
}) {
  const defaultDuration = input.defaultDuration ?? 30
  const roundedStart = clampMinutes(
    floorMinutesToStep(input.minutes, SCHEDULE_GRID_STEP_MINUTES),
    input.dayStartMinutes,
    input.dayEndMinutes - defaultDuration
  )

  return {
    startMinutes: roundedStart,
    endMinutes: clampMinutes(
      roundedStart + defaultDuration,
      roundedStart + SCHEDULE_GRID_STEP_MINUTES,
      input.dayEndMinutes
    ),
    durationMinutes: defaultDuration,
  }
}
