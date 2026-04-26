import type { Metadata } from 'next'
import { AuthorizationError, requireSession } from '@/lib/auth'
import { loadAiAssistantWorkspace } from '@/lib/assistant-chat'
import { AssistantChatPanel } from '@/components/assistente/assistant-chat-panel'
import { PageHeader } from '@/components/layout/page-header'

export const metadata: Metadata = { title: 'BarberEX IA' }

export default async function AssistentePage() {
  const session = await requireSession()

  try {
    const workspace = await loadAiAssistantWorkspace({
      userId: session.user.id,
      barbershopId: session.user.barbershopId,
      role: session.user.role,
      name: session.user.name,
      email: session.user.email,
    })

    return (
      <div className="page-section flex flex-col gap-5">
        <PageHeader
          title="BarberEX IA"
          description="Pergunte sobre agenda, clientes, metas e numeros do periodo. O contexto e montado no backend e respeita o escopo do seu perfil."
        />

        <AssistantChatPanel workspace={workspace} />
      </div>
    )
  } catch (error) {
    if (error instanceof AuthorizationError) {
      return (
        <div className="page-section flex flex-col gap-5">
          <PageHeader
            title="BarberEX IA"
            description="Seu acesso esta autenticado, mas ainda falta contexto operacional suficiente para abrir o assistente."
          />

          <section className="dashboard-panel p-6">
            <h2 className="text-[1.4rem] font-semibold tracking-tight text-foreground">
              Ainda nao conseguimos liberar essa conversa para o seu perfil.
            </h2>
            <p className="mt-3 max-w-2xl text-sm leading-7 text-muted-foreground">
              {error.message}
            </p>
          </section>
        </div>
      )
    }

    throw error
  }
}
