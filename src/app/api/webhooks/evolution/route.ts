import { NextResponse } from 'next/server'
import {
  isEvolutionWebhookRequestAuthorized,
  normalizeEvolutionWebhookPayload,
} from '@/lib/integrations/evolution'
import { handleIncomingWhatsAppMessage } from '@/lib/whatsapp-handler'

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
  const phone = normalized.remotePhone
  const message = normalized.text
  const result = await handleIncomingWhatsAppMessage({
    provider: 'EVOLUTION',
    event: normalized.event,
    instanceName: normalized.instanceName,
    phone,
    message,
    contactName: normalized.contactName,
    remoteJid: normalized.remoteJid,
    messageId: normalized.messageId,
    dedupeKey: normalized.dedupeKey,
    payload,
    shouldProcessInboundMessage: normalized.shouldProcessInboundMessage,
    ignoreReason: normalized.ignoreReason,
  })

  if (result.code === 409) {
    console.warn('[evolution-webhook] returning 409', {
      instanceNameReceived: 'diagnostics' in result ? result.diagnostics?.instanceNameReceived ?? normalized.instanceName : normalized.instanceName,
      configuredInstance: 'diagnostics' in result ? result.diagnostics?.configuredInstance ?? null : null,
      explicitBarbershopSlug: 'diagnostics' in result ? result.diagnostics?.explicitBarbershopSlug ?? null : null,
      foundBarbershopSlug: 'diagnostics' in result ? result.diagnostics?.foundBarbershopSlug ?? null : null,
      foundBarbershopName: 'diagnostics' in result ? result.diagnostics?.foundBarbershopName ?? null : null,
      matchedBy: 'diagnostics' in result ? result.diagnostics?.matchedBy ?? null : null,
      finalReason: 'diagnostics' in result ? result.diagnostics?.finalReason ?? result.reason : result.reason,
    })
  }

  return NextResponse.json(
    result.code === 409
      ? {
          ok: false,
          error: 'Tenant nao configurado para esta instancia.',
          replySent: false,
        }
      : {
          ok: result.ok,
          reason: result.reason,
          eventId: result.eventId,
          phone,
          message,
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
