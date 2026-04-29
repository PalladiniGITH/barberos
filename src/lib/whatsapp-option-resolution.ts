import 'server-only'

export interface NamedOptionLike {
  name: string
}

export interface NamedOptionWithId extends NamedOptionLike {
  id: string
}

export interface ProfessionalSlotLike {
  professionalId: string
  professionalName: string
}

export interface PresentedSlotLike extends ProfessionalSlotLike {
  timeLabel: string
}

export interface PresentedSlotSelectionResolution<T extends PresentedSlotLike> {
  slot: T | null
  requestedTimeLabel: string | null
  pendingProfessionalOptions: NamedOptionWithId[]
}

export function normalizeNamedOptionText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .trim()
}

function normalizeServiceQuery(value: string) {
  return normalizeNamedOptionText(value)
    .replace(/\s+/g, ' ')
    .trim()
}

function optionNameTokens(value: string) {
  return normalizeNamedOptionText(value)
    .split(/[^a-z0-9]+/)
    .filter((token) => token.length >= 2)
}

function dedupeNamedOptions<T extends NamedOptionLike>(options: T[]) {
  const seen = new Set<string>()

  return options.filter((option) => {
    const key = normalizeNamedOptionText(option.name)
    if (!key || seen.has(key)) {
      return false
    }

    seen.add(key)
    return true
  })
}

function hasHaircutKeyword(value: string) {
  return /\b(corte|cabelo|cortar)\b/.test(value)
}

function hasBeardKeyword(value: string) {
  return /\bbarba\b/.test(value)
}

function isComboServiceOption(option: NamedOptionLike) {
  const normalizedName = normalizeServiceQuery(option.name)
  return hasBeardKeyword(normalizedName)
    && (hasHaircutKeyword(normalizedName) || normalizedName.includes('combo'))
}

function isHaircutOnlyServiceOption(option: NamedOptionLike) {
  const normalizedName = normalizeServiceQuery(option.name)
  return hasHaircutKeyword(normalizedName)
    && !hasBeardKeyword(normalizedName)
    && !normalizedName.includes('combo')
}

function isComboServiceIntent(query: string) {
  const normalizedQuery = normalizeServiceQuery(query)

  if (!normalizedQuery) {
    return false
  }

  return (
    /\bcorte\s*(?:\+|mais|com)?\s*barba\b/.test(normalizedQuery)
    || /\bcabelo\s+e\s+barba\b/.test(normalizedQuery)
    || /\bcortar\s+cabelo\s+e\s+barba\b/.test(normalizedQuery)
    || /\bcombo\s+(?:de\s+)?corte\s+e\s+barba\b/.test(normalizedQuery)
    || /\bpacote\s+(?:de\s+)?corte\s+e\s+barba\b/.test(normalizedQuery)
    || /\bcorte\s+barba\b/.test(normalizedQuery)
    || (hasHaircutKeyword(normalizedQuery) && hasBeardKeyword(normalizedQuery))
  )
}

function isHaircutOnlyServiceIntent(query: string) {
  const normalizedQuery = normalizeServiceQuery(query)
  return hasHaircutKeyword(normalizedQuery)
    && !hasBeardKeyword(normalizedQuery)
    && !normalizedQuery.includes('combo')
}

export function extractExplicitServiceCorrectionQuery(message: string) {
  const normalizedMessage = normalizeServiceQuery(message)
  if (!normalizedMessage) {
    return null
  }

  const explicitReplacement =
    normalizedMessage.match(/\b(?:nao e|nao eh)\s+.+?,\s*(?:e|eh)\s+(.+)$/)
    || normalizedMessage.match(/\b(?:nao e|nao eh)\s+.+?\s+mas\s+(.+)$/)

  if (explicitReplacement?.[1]) {
    return explicitReplacement[1].trim()
  }

  const stripped = normalizedMessage.replace(
    /^(?:nao e|nao eh|nao,?|na verdade|troca(?:r)?(?:\s+para)?|quero dizer|quis dizer|seria|eh)\s+/,
    ''
  ).trim()

  return stripped && stripped !== normalizedMessage
    ? stripped
    : null
}

function scoreNamedOptionMatch<T extends NamedOptionLike>(option: T, queryTokens: string[]) {
  const optionTokens = optionNameTokens(option.name).filter((token) => token.length >= 3)
  if (optionTokens.length === 0) {
    return 0
  }

  return optionTokens.reduce((score, optionToken) => {
    if (queryTokens.includes(optionToken)) {
      return score + 3
    }

    if (optionToken.length >= 4 && queryTokens.some((queryToken) =>
      queryToken.startsWith(optionToken)
      || optionToken.startsWith(queryToken)
    )) {
      return score + 2
    }

    return score
  }, 0)
}

export function findNamedOptionCandidates<T extends NamedOptionLike>(options: T[], query: string) {
  const normalizedQuery = normalizeNamedOptionText(query)
  if (!normalizedQuery) {
    return []
  }

  const exactMatches = dedupeNamedOptions(
    options.filter((option) => normalizeNamedOptionText(option.name) === normalizedQuery)
  )
  if (exactMatches.length > 0) {
    return exactMatches
  }

  const fullNameMatches = dedupeNamedOptions(
    options.filter((option) => normalizedQuery.includes(normalizeNamedOptionText(option.name)))
  )
  if (fullNameMatches.length > 0) {
    return fullNameMatches
  }

  const queryTokens = optionNameTokens(query)
  if (queryTokens.length === 0) {
    return []
  }

  const scoredMatches = options
    .map((option) => ({
      option,
      score: scoreNamedOptionMatch(option, queryTokens),
    }))
    .filter((entry) => entry.score > 0)

  if (scoredMatches.length === 0) {
    return []
  }

  const bestScore = Math.max(...scoredMatches.map((entry) => entry.score))

  return dedupeNamedOptions(
    scoredMatches
      .filter((entry) => entry.score === bestScore)
      .map((entry) => entry.option)
  )
}

export function findServiceCandidates<T extends NamedOptionLike>(options: T[], query: string) {
  const normalizedQuery = normalizeServiceQuery(query)
  if (!normalizedQuery) {
    return []
  }

  const candidateQueries = Array.from(new Set([
    extractExplicitServiceCorrectionQuery(query),
    normalizedQuery,
  ].filter((value): value is string => Boolean(value && value.trim()))))

  for (const candidateQuery of candidateQueries) {
    const directCandidates = findNamedOptionCandidates(options, candidateQuery)

    if (isComboServiceIntent(candidateQuery)) {
      const comboCandidates = dedupeNamedOptions(
        (directCandidates.length > 0 ? directCandidates : options)
          .filter((option) => isComboServiceOption(option))
      )

      if (comboCandidates.length > 0) {
        return comboCandidates
      }
    }

    if (isHaircutOnlyServiceIntent(candidateQuery)) {
      const haircutCandidates = dedupeNamedOptions(
        (directCandidates.length > 0 ? directCandidates : options)
          .filter((option) => isHaircutOnlyServiceOption(option))
      )

      if (haircutCandidates.length > 0) {
        return haircutCandidates
      }
    }

    if (directCandidates.length > 0) {
      return directCandidates
    }
  }

  return []
}

export function pickNamedOptionBySelection<T extends NamedOptionLike>(input: {
  options: T[]
  selectedOptionNumber: number | null
  message: string
}) {
  if (
    input.selectedOptionNumber
    && input.selectedOptionNumber >= 1
    && input.selectedOptionNumber <= input.options.length
  ) {
    return input.options[input.selectedOptionNumber - 1] ?? null
  }

  const candidates = findNamedOptionCandidates(input.options, input.message)
  return candidates.length === 1 ? candidates[0] ?? null : null
}

export function buildNamedProfessionalOptionsFromSlots<T extends ProfessionalSlotLike>(slots: T[]) {
  const seen = new Set<string>()
  const options: NamedOptionWithId[] = []

  for (const slot of slots) {
    const key = slot.professionalId || normalizeNamedOptionText(slot.professionalName)
    if (!key || seen.has(key)) {
      continue
    }

    seen.add(key)
    options.push({
      id: slot.professionalId,
      name: slot.professionalName,
    })
  }

  return options
}

function matchesPresentedSlotProfessionalSelection<T extends ProfessionalSlotLike>(input: {
  slot: T
  message: string
  professionalName?: string | null
}) {
  const normalizedMessage = normalizeNamedOptionText(input.message)
  const normalizedProfessionalName = input.professionalName
    ? normalizeNamedOptionText(input.professionalName)
    : ''

  if (
    normalizedProfessionalName
    && normalizeNamedOptionText(input.slot.professionalName).includes(normalizedProfessionalName)
  ) {
    return true
  }

  return optionNameTokens(input.slot.professionalName).some((token) =>
    normalizedMessage === token
    || normalizedMessage.startsWith(`${token} `)
    || normalizedMessage.includes(` ${token}`)
  )
}

export function resolvePresentedSlotSelection<T extends PresentedSlotLike>(input: {
  offeredSlots: T[]
  selectedOptionNumber: number | null
  requestedTimeLabel?: string | null
  professionalName?: string | null
  preferredTimeLabel?: string | null
  message: string
}): PresentedSlotSelectionResolution<T> {
  if (
    input.selectedOptionNumber
    && input.selectedOptionNumber >= 1
    && input.selectedOptionNumber <= input.offeredSlots.length
  ) {
    return {
      slot: input.offeredSlots[input.selectedOptionNumber - 1] ?? null,
      requestedTimeLabel: null,
      pendingProfessionalOptions: [],
    }
  }

  const normalizedMessage = normalizeNamedOptionText(input.message)
  const requestedTimeLabel =
    input.requestedTimeLabel
    ?? input.offeredSlots.find((slot) => normalizeNamedOptionText(slot.timeLabel) === normalizedMessage)?.timeLabel
    ?? null

  if (requestedTimeLabel) {
    const sameTimeSlots = input.offeredSlots.filter((slot) => slot.timeLabel === requestedTimeLabel)
    const professionalOptions = buildNamedProfessionalOptionsFromSlots(sameTimeSlots).slice(0, 4)

    if (professionalOptions.length === 1) {
      return {
        slot: sameTimeSlots[0] ?? null,
        requestedTimeLabel,
        pendingProfessionalOptions: [],
      }
    }

    if (professionalOptions.length > 1) {
      return {
        slot: null,
        requestedTimeLabel,
        pendingProfessionalOptions: professionalOptions,
      }
    }
  }

  const preferredTimeSlots = input.preferredTimeLabel
    ? input.offeredSlots.filter((slot) => slot.timeLabel === input.preferredTimeLabel)
    : []

  const preferredTimeProfessionalMatch = preferredTimeSlots.find((slot) =>
    matchesPresentedSlotProfessionalSelection({
      slot,
      message: input.message,
      professionalName: input.professionalName,
    })
  )

  if (preferredTimeProfessionalMatch) {
    return {
      slot: preferredTimeProfessionalMatch,
      requestedTimeLabel: preferredTimeProfessionalMatch.timeLabel,
      pendingProfessionalOptions: [],
    }
  }

  const professionalMatch = input.offeredSlots.find((slot) =>
    matchesPresentedSlotProfessionalSelection({
      slot,
      message: input.message,
      professionalName: input.professionalName,
    })
  )

  return {
    slot: professionalMatch ?? null,
    requestedTimeLabel: professionalMatch?.timeLabel ?? requestedTimeLabel ?? null,
    pendingProfessionalOptions: [],
  }
}
