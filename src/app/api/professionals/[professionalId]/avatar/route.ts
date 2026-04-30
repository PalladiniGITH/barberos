import { NextResponse } from 'next/server'
import { prisma } from '@/lib/prisma'
import {
  AuthenticationRequiredError,
  requireSession,
} from '@/lib/auth'
import {
  deleteProfessionalAvatarFile,
  storeProfessionalAvatarFile,
  ProfessionalAvatarUploadError,
} from '@/lib/professionals/avatar-storage'
import { revalidateProfessionalSurfaces } from '@/lib/professionals/revalidation'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function jsonError(message: string, status: number) {
  return NextResponse.json({ error: message }, { status })
}

export async function POST(
  request: Request,
  context: { params: { professionalId: string } }
) {
  try {
    const session = await requireSession()

    if (session.user.role === 'BARBER') {
      return jsonError('Sem permissao para alterar fotos da equipe.', 403)
    }

    const professionalId = context.params.professionalId
    const professional = await prisma.professional.findUnique({
      where: { id: professionalId },
      select: {
        id: true,
        barbershopId: true,
        avatar: true,
      },
    })

    if (!professional || professional.barbershopId !== session.user.barbershopId) {
      return jsonError('Profissional nao encontrado para este tenant.', 404)
    }

    const formData = await request.formData()
    const uploadedFile = formData.get('file')

    if (!(uploadedFile instanceof File)) {
      return jsonError('Selecione uma imagem valida para continuar.', 400)
    }

    const storedAvatar = await storeProfessionalAvatarFile({
      file: uploadedFile,
      barbershopId: session.user.barbershopId,
      professionalId,
    })

    try {
      await prisma.professional.update({
        where: { id: professionalId },
        data: { avatar: storedAvatar.avatarUrl },
      })
    } catch (error) {
      await deleteProfessionalAvatarFile(storedAvatar.avatarUrl).catch(() => null)
      throw error
    }

    await deleteProfessionalAvatarFile(professional.avatar).catch(() => null)
    revalidateProfessionalSurfaces()

    return NextResponse.json(
      {
        success: true,
        avatarUrl: storedAvatar.avatarUrl,
      },
      { status: 200 }
    )
  } catch (error) {
    if (error instanceof AuthenticationRequiredError) {
      return jsonError('Sessao expirada. Entre novamente para enviar a foto.', 401)
    }

    if (error instanceof ProfessionalAvatarUploadError) {
      return jsonError(error.message, error.statusCode)
    }

    console.error('[professional-avatar-upload] unexpected error', error)
    return jsonError('Nao foi possivel enviar a foto agora.', 500)
  }
}

