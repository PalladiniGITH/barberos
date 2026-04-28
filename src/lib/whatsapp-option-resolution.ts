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

export function normalizeNamedOptionText(value: string) {
  return value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
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
