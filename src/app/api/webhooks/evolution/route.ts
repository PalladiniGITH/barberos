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

  return NextResponse.json(
    {
      ok: result.ok,
      reason: result.reason,
      eventId: result.eventId,
      phone,
      message,
      customerId: 'customerId' in result ? result.customerId : undefined,
      customerCreated: 'customerCreated' in result ? result.customerCreated : undefined,
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
