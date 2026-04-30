import { NextResponse } from 'next/server'
import {
  ProfessionalAvatarUploadError,
  readProfessionalAvatarFile,
} from '@/lib/professionals/avatar-storage'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

export async function GET(
  _request: Request,
  context: { params: { barbershopId: string; fileName: string } }
) {
  try {
    const avatarFile = await readProfessionalAvatarFile({
      barbershopId: context.params.barbershopId,
      fileName: context.params.fileName,
    })

    if (!avatarFile) {
      return new NextResponse('Not found', { status: 404 })
    }

    return new NextResponse(avatarFile.buffer, {
      status: 200,
      headers: {
        'Content-Type': avatarFile.contentType,
        'Cache-Control': 'public, max-age=31536000, immutable',
        'Content-Disposition': 'inline',
        'X-Content-Type-Options': 'nosniff',
      },
    })
  } catch (error) {
    if (error instanceof ProfessionalAvatarUploadError) {
      return new NextResponse(error.message, { status: error.statusCode })
    }

    console.error('[professional-avatar-file] unexpected error', error)
    return new NextResponse('Internal Server Error', { status: 500 })
  }
}
