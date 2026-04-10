import 'server-only'

import { normalizeEvolutionWebhookPayload } from '@/lib/integrations/evolution'
import { handleIncomingWhatsAppMessage } from '@/lib/whatsapp-handler'

export async function processEvolutionWebhookPayload(payload: unknown) {
  const normalized = normalizeEvolutionWebhookPayload(payload)

  return handleIncomingWhatsAppMessage({
    provider: 'EVOLUTION',
    event: normalized.event,
    instanceName: normalized.instanceName,
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
