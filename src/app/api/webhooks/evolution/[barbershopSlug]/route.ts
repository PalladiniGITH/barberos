import { NextResponse } from 'next/server'
import {
  isEvolutionWebhookRequestAuthorized,
  normalizeEvolutionWebhookPayload,
} from '@/lib/integrations/evolution'
import { processEvolutionWebhookPayload } from '@/lib/integrations/evolution-webhook'

export const runtime = 'nodejs'

export async function POST(
  request: Request,
  context: { params: { barbershopSlug: string } }
) {
  if (!isEvolutionWebhookRequestAuthorized(request)) {
    return NextResponse.json(
      { ok: false, error: 'Webhook Evolution nao autorizado.' },
      { status: 401 }
    )
  }

  let payload: unknown

  try {
    payload = await request.json()
  } catch {
    return NextResponse.json(
      { ok: false, error: 'Payload JSON invalido.' },
      { status: 400 }
    )
  }

  const normalized = normalizeEvolutionWebhookPayload(payload)
  const result = await processEvolutionWebhookPayload(payload, {
    routeBarbershopSlug: context.params.barbershopSlug,
  })

  if (result.code === 409 || result.code === 202) {
    console.warn('[evolution-webhook] tenant not processed', {
      routeSlug: context.params.barbershopSlug,
      instanceNameReceived: 'diagnostics' in result ? result.diagnostics?.instanceNameReceived ?? normalized.instanceName : normalized.instanceName,
      matchedBy: 'diagnostics' in result ? result.diagnostics?.matchedBy ?? null : null,
      finalReason: 'diagnostics' in result ? result.diagnostics?.reason ?? result.reason : result.reason,
    })
  }

  return NextResponse.json(
    result.code === 409 || result.code === 202
      ? {
          ok: result.code !== 409,
          error: 'Tenant nao configurado para esta instancia.',
          reason: result.reason,
          replySent: false,
        }
      : {
          ok: result.ok,
          reason: result.reason,
          eventId: result.eventId,
          phone: normalized.remotePhone,
          message: normalized.text,
          customerId: 'customerId' in result ? result.customerId : undefined,
          customerCreated: 'customerCreated' in result ? result.customerCreated : undefined,
          conversationId: 'conversationId' in result ? result.conversationId : undefined,
          conversationState: 'conversationState' in result ? result.conversationState : undefined,
          appointmentId: 'appointmentId' in result ? result.appointmentId : undefined,
          usedAI: 'usedAI' in result ? result.usedAI : undefined,
          replySent: result.replySent,
          error: 'error' in result ? result.error : undefined,
        },
    { status: result.code }
  )
}

export async function GET(request: Request) {
  if (!isEvolutionWebhookRequestAuthorized(request)) {
    return NextResponse.json(
      { ok: false, error: 'Webhook Evolution nao autorizado.' },
      { status: 401 }
    )
  }

  return NextResponse.json({
    ok: true,
    status: 'ready',
    provider: 'evolution',
    sample: normalizeEvolutionWebhookPayload({ event: 'MESSAGES_UPSERT' }),
  })
}
