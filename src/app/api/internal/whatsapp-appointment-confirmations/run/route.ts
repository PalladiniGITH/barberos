import { NextResponse } from 'next/server'
import {
  isWhatsAppAppointmentConfirmationRequestAuthorized,
  runDueWhatsAppAppointmentConfirmations,
} from '@/lib/whatsapp-appointment-reminders'

export const runtime = 'nodejs'

export async function POST(request: Request) {
  if (!isWhatsAppAppointmentConfirmationRequestAuthorized(request)) {
    return NextResponse.json(
      { ok: false, error: 'WhatsApp appointment confirmation request not authorized.' },
      { status: 401 }
    )
  }

  try {
    const summary = await runDueWhatsAppAppointmentConfirmations()

    return NextResponse.json({
      ok: true,
      summary,
    })
  } catch (error) {
    console.error('[whatsapp-reminder-route] run_failed', {
      message: error instanceof Error ? error.message : String(error),
    })

    return NextResponse.json(
      { ok: false, error: 'WhatsApp appointment confirmation run failed.' },
      { status: 500 }
    )
  }
}
