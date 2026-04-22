import { NextResponse } from 'next/server'
import { CampaignAutomationTrigger } from '@prisma/client'
import {
  isCampaignAutomationRequestAuthorized,
  runDueCustomerCampaignAutomation,
} from '@/lib/campaign-automation'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  if (!isCampaignAutomationRequestAuthorized(request)) {
    return NextResponse.json(
      { ok: false, error: 'Campaign automation request not authorized.' },
      { status: 401 }
    )
  }

  try {
    const summary = await runDueCustomerCampaignAutomation({
      trigger: CampaignAutomationTrigger.SCHEDULER,
    })

    return NextResponse.json({
      ok: true,
      summary,
    })
  } catch (error) {
    console.error('[campaign-automation-route] run_failed', {
      message: error instanceof Error ? error.message : String(error),
    })

    return NextResponse.json(
      { ok: false, error: 'Campaign automation run failed.' },
      { status: 500 }
    )
  }
}
