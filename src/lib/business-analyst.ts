import 'server-only'

import { cache } from 'react'
import { assertAdministrativeRole } from '@/lib/auth'
import {
  buildDeterministicBusinessReport,
  type BusinessIntelligenceReport,
  type CustomerTypeFilter,
} from '@/lib/business-insights'
import { getBusinessInsightsData } from '@/lib/insights-data'
import {
  describeBusinessAnalystMode,
  generateOpenAIBusinessReport,
  isOpenAIBusinessAnalystEnabled,
} from '@/lib/ai/openai-business-analyst'

function withLocalActiveLabel(report: BusinessIntelligenceReport): BusinessIntelligenceReport {
  return {
    ...report,
    runtime: {
      ...report.runtime,
      userModeLabel: 'Analise local ativa no momento',
    },
  }
}

export async function getBusinessAnalystReport(params: {
  barbershopId: string
  month: number
  year: number
  professionalId?: string | null
  customerType?: CustomerTypeFilter
  viewerRole: string | null | undefined
}): Promise<BusinessIntelligenceReport> {
  assertAdministrativeRole(
    params.viewerRole,
    'Sem permissao para consultar a inteligencia global da barbearia.'
  )

  return getBusinessAnalystReportCached(
    params.barbershopId,
    params.month,
    params.year,
    params.professionalId ?? null,
    params.customerType ?? 'all'
  )
}

const getBusinessAnalystReportCached = cache(async (
  barbershopId: string,
  month: number,
  year: number,
  professionalId: string | null,
  customerType: CustomerTypeFilter
): Promise<BusinessIntelligenceReport> => {
  const context = await getBusinessInsightsData({
    barbershopId,
    month,
    year,
    professionalId,
    customerType,
  })

  // Layer 1 always exists and stays tenant-scoped.
  const deterministic = buildDeterministicBusinessReport(context)

  // Layer 2 is optional. Any OpenAI failure falls back to the local engine.
  if (!isOpenAIBusinessAnalystEnabled()) {
    return deterministic
  }

  try {
    const aiAttempt = await generateOpenAIBusinessReport({
      context,
      deterministic,
    })

    if (aiAttempt.report) {
      return aiAttempt.report
    }

    if (aiAttempt.failureReason === 'timeout') {
      return withLocalActiveLabel(deterministic)
    }

    return deterministic
  } catch {
    return deterministic
  }
})

export function getBusinessAnalystIntegrationStatus() {
  return {
    deterministicReady: true,
    openAIConfigured: isOpenAIBusinessAnalystEnabled(),
    fallbackMode: describeBusinessAnalystMode('deterministic'),
    aiMode: describeBusinessAnalystMode('ai'),
  }
}
