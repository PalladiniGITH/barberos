import { NextResponse } from 'next/server'
import {
  isEvolutionWebhookRequestAuthorized,
  normalizeEvolutionWebhookPayload,
} from '@/lib/integrations/evolution'
import { processEvolutionWebhookPayload } from '@/lib/integrations/evolution-webhook'
import { safeLog } from '@/lib/security/safe-logger'

export const runtime = 'nodejs'

export async function POST(request: Request) {
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
  safeLog('info', '[evolution-webhook] normalized payload', {
    eventOriginal: normalized.originalEvent,
    eventNormalized: normalized.event,
    shouldProcessInboundMessage: normalized.shouldProcessInboundMessage,
    ignoreReason: normalized.ignoreReason,
    fromMe: normalized.fromMe,
    messageType: normalized.messageType,
  })

  if (!normalized.shouldProcessInboundMessage) {
    safeLog('warn', '[evolution-webhook] inbound message ignored before handler', {
      eventOriginal: normalized.originalEvent,
      eventNormalized: normalized.event,
      shouldProcessInboundMessage: normalized.shouldProcessInboundMessage,
      ignoreReason: normalized.ignoreReason,
      fromMe: normalized.fromMe,
      messageType: normalized.messageType,
    })
  }

  const result = await processEvolutionWebhookPayload(payload)

  if (result.code === 409 || result.code === 202) {
    safeLog('warn', '[evolution-webhook] tenant not processed', {
      instanceNameReceived: 'diagnostics' in result ? result.diagnostics?.instanceNameReceived ?? normalized.instanceName : normalized.instanceName,
      routeSlug: 'diagnostics' in result ? result.diagnostics?.routeSlug ?? null : null,
      barbershopId: 'diagnostics' in result ? result.diagnostics?.barbershopId ?? null : null,
      barbershopSlug: 'diagnostics' in result ? result.diagnostics?.barbershopSlug ?? null : null,
      barbershopName: 'diagnostics' in result ? result.diagnostics?.barbershopName ?? null : null,
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
