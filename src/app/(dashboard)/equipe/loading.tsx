function SkeletonBlock({ className }: { className: string }) {
  return <div className={`animate-pulse rounded-[1rem] bg-[rgba(255,255,255,0.06)] ${className}`} />
}

export default function EquipeLoading() {
  return (
    <div className="page-section mx-auto flex max-w-7xl flex-col gap-5">
      <section className="dashboard-panel overflow-hidden px-6 py-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-3">
            <SkeletonBlock className="h-10 w-56 max-w-full" />
            <SkeletonBlock className="h-4 w-[34rem] max-w-full" />
          </div>
          <SkeletonBlock className="h-11 w-full max-w-[16rem]" />
        </div>
      </section>

      <div className="toolbar-surface h-16 animate-pulse" />

      <section className="dashboard-panel dashboard-spotlight p-6">
        <div className="grid gap-3 md:grid-cols-4">
          {Array.from({ length: 4 }).map((_, index) => (
            <div key={index} className="surface-tier-low p-4">
              <SkeletonBlock className="h-3 w-24" />
              <SkeletonBlock className="mt-3 h-8 w-28" />
              <SkeletonBlock className="mt-3 h-3 w-32" />
            </div>
          ))}
        </div>
      </section>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="executive-metric p-5">
            <SkeletonBlock className="h-3 w-20" />
            <SkeletonBlock className="mt-4 h-7 w-24" />
            <SkeletonBlock className="mt-3 h-4 w-40" />
            <SkeletonBlock className="mt-5 h-4 w-32" />
          </div>
        ))}
      </div>
    </div>
  )
}
