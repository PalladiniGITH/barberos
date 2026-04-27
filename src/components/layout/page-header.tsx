import type { ReactNode } from 'react'

interface PageHeaderProps {
  title: string
  description?: string
  action?: ReactNode
}

export function PageHeader({ title, description, action }: PageHeaderProps) {
  return (
    <div className="mb-5 flex flex-col gap-3 xl:flex-row xl:items-end xl:justify-between">
      <div className="max-w-[52rem]">
        <h1 className="page-title">
          {title}
        </h1>
        {description && (
          <p className="page-copy mt-2.5 max-w-3xl">{description}</p>
        )}
      </div>
      {action && (
        <div className="flex flex-wrap items-center gap-2.5">
          {action}
        </div>
      )}
    </div>
  )
}
