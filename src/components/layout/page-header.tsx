import type { ReactNode } from 'react'

interface PageHeaderProps {
  title: string
  description?: string
  action?: ReactNode
}

export function PageHeader({ title, description, action }: PageHeaderProps) {
  return (
    <div className="mb-6 flex flex-col gap-5 xl:flex-row xl:items-end xl:justify-between">
      <div className="max-w-3xl">
        <p className="page-kicker">Painel operacional</p>
        <h1 className="page-title mt-3">
          {title}
        </h1>
        {description && (
          <p className="page-copy mt-3 max-w-2xl">{description}</p>
        )}
      </div>
      {action && (
        <div className="flex flex-wrap items-center gap-2 rounded-[1.2rem] border border-[rgba(58,47,86,0.08)] bg-[rgba(255,255,255,0.72)] p-2 shadow-[0_18px_36px_-32px_rgba(22,16,39,0.16)]">
          {action}
        </div>
      )}
    </div>
  )
}
