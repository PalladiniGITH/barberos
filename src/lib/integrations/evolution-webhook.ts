import 'server-only'

import { normalizeEvolutionWebhookPayload } from '@/lib/integrations/evolution'
import { safeLog } from '@/lib/security/safe-logger'
import { handleIncomingWhatsAppMessage } from '@/lib/whatsapp-handler'

export async function processEvolutionWebhookPayload(
  payload: unknown,
  options?: {
    routeBarbershopSlug?: string | null
  }
) {
  const normalized = normalizeEvolutionWebhookPayload(payload)

  safeLog('info', '[evolution-webhook] normalized payload', {
    eventOriginal: normalized.originalEvent,
    eventNormalized: normalized.event,
    shouldProcessInboundMessage: normalized.shouldProcessInboundMessage,
    ignoreReason: normalized.ignoreReason,
    fromMe: normalized.fromMe,
    messageType: normalized.messageType,
  })

  return handleIncomingWhatsAppMessage({
    provider: 'EVOLUTION',
    event: normalized.event,
    instanceName: normalized.instanceName,
    routeBarbershopSlug: options?.routeBarbershopSlug ?? null,
    phone: normalized.remotePhone,
    message: normalized.text,
    contactName: normalized.contactName,
    remoteJid: normalized.remoteJid,
    messageId: normalized.messageId,
    dedupeKey: normalized.dedupeKey,
    payload,
    shouldProcessInboundMessage: normalized.shouldProcessInboundMessage,
    ignoreReason: normalized.ignoreReason,
  })
}
