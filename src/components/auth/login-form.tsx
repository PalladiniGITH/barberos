'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { signIn } from 'next-auth/react'
import { useForm } from 'react-hook-form'
import { zodResolver } from '@hookform/resolvers/zod'
import { z } from 'zod'
import { CheckCircle2, Eye, EyeOff, Loader2 } from 'lucide-react'

const schema = z.object({
  email: z.string().email('Email invalido'),
  password: z.string().min(1, 'Senha obrigatoria'),
})

type FormData = z.infer<typeof schema>

const demoAccounts = [
  { label: 'Proprietario', email: 'gestao@linhanobre.com.br' },
  { label: 'Gerente', email: 'gerencia@linhanobre.com.br' },
  { label: 'Financeiro', email: 'financeiro@linhanobre.com.br' },
]

export function LoginForm() {
  const router = useRouter()
  const [showPassword, setShowPassword] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const {
    register,
    handleSubmit,
    formState: { errors, isSubmitting },
  } = useForm<FormData>({
    resolver: zodResolver(schema),
  })

  async function onSubmit(data: FormData) {
    setError(null)

    const result = await signIn('credentials', {
      email: data.email,
      password: data.password,
      redirect: false,
    })

    if (result?.error) {
      setError('Email ou senha incorretos')
      return
    }

    router.push('/dashboard')
    router.refresh()
  }

  return (
    <form onSubmit={handleSubmit(onSubmit)} className="space-y-5">
      <div>
        <label className="mb-2 block text-sm font-semibold text-foreground">Email</label>
        <input
          {...register('email')}
          type="email"
          placeholder="gestao@linhanobre.com.br"
          autoComplete="email"
          className="auth-input"
        />
        {errors.email && <p className="mt-2 text-sm text-destructive">{errors.email.message}</p>}
      </div>

      <div>
        <label className="mb-2 block text-sm font-semibold text-foreground">Senha</label>
        <div className="relative">
          <input
            {...register('password')}
            type={showPassword ? 'text' : 'password'}
            placeholder="demo123456"
            autoComplete="current-password"
            className="auth-input pr-12"
          />
          <button
            type="button"
            onClick={() => setShowPassword((current) => !current)}
            className="absolute right-3 top-1/2 inline-flex h-9 w-9 -translate-y-1/2 items-center justify-center rounded-full border border-transparent text-muted-foreground transition-colors hover:border-[rgba(255,255,255,0.08)] hover:bg-[rgba(255,255,255,0.05)] hover:text-foreground"
          >
            {showPassword ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
          </button>
        </div>
        {errors.password && <p className="mt-2 text-sm text-destructive">{errors.password.message}</p>}
      </div>

      {error && (
        <div className="rounded-[1.2rem] border border-[rgba(251,113,133,0.18)] bg-[rgba(251,113,133,0.1)] px-4 py-3 text-sm text-rose-200">
          {error}
        </div>
      )}

      <button
        type="submit"
        disabled={isSubmitting}
        className="flex w-full items-center justify-center gap-2 rounded-[1.2rem] bg-[linear-gradient(135deg,rgba(15,23,42,0.98),rgba(30,41,59,0.94))] px-4 py-3 text-sm font-semibold text-slate-50 shadow-[0_18px_34px_-20px_rgba(15,23,42,0.65)] transition-all hover:-translate-y-0.5 hover:shadow-[0_24px_42px_-22px_rgba(15,23,42,0.7)] disabled:translate-y-0 disabled:cursor-not-allowed disabled:opacity-60"
      >
        {isSubmitting ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
        {isSubmitting ? 'Entrando...' : 'Entrar no painel'}
      </button>

      <div className="rounded-[1.4rem] border border-[rgba(255,255,255,0.08)] bg-[linear-gradient(180deg,rgba(30,41,59,0.78),rgba(15,23,42,0.72))] p-4 shadow-[0_18px_38px_-28px_rgba(2,6,23,0.78)]">
        <div className="flex items-start justify-between gap-3">
          <div>
            <p className="page-kicker">Acesso demo</p>
            <p className="mt-2 text-sm leading-6 text-muted-foreground">
              Use qualquer conta abaixo com a senha padrao para navegar pelo produto.
            </p>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full border border-[rgba(52,211,153,0.18)] bg-[rgba(52,211,153,0.1)] px-3 py-1 text-xs font-semibold text-emerald-200">
            <CheckCircle2 className="h-3.5 w-3.5" />
            Pronto para demo
          </span>
        </div>

        <div className="mt-4 space-y-3">
          {demoAccounts.map((account) => (
            <div
              key={account.email}
              className="flex items-center justify-between gap-3 rounded-[1.2rem] border border-[rgba(255,255,255,0.08)] bg-[rgba(255,255,255,0.04)] px-4 py-3 shadow-[0_16px_28px_-24px_rgba(2,6,23,0.82)]"
            >
              <div className="min-w-0">
                <p className="text-sm font-semibold text-foreground">{account.label}</p>
                <p className="truncate font-mono text-xs text-muted-foreground">{account.email}</p>
              </div>
              <span className="rounded-full border border-slate-900/10 bg-[linear-gradient(135deg,rgba(15,23,42,0.98),rgba(30,41,59,0.92))] px-3 py-1.5 text-xs font-semibold text-slate-100">
                demo123456
              </span>
            </div>
          ))}
        </div>
      </div>
    </form>
  )
}
