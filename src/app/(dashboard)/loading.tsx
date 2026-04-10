export default function DashboardLoading() {
  return (
    <div className="page-section mx-auto flex max-w-[1680px] flex-col gap-5">
      <section className="dashboard-panel overflow-hidden px-6 py-5">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-end xl:justify-between">
          <div className="space-y-3">
            <div className="h-3 w-24 rounded-full bg-[rgba(255,255,255,0.08)]" />
            <div className="h-10 w-72 rounded-full bg-[rgba(255,255,255,0.08)]" />
            <div className="h-4 w-[32rem] max-w-full rounded-full bg-[rgba(255,255,255,0.05)]" />
          </div>
          <div className="h-11 w-full max-w-[28rem] rounded-[1rem] bg-[rgba(255,255,255,0.05)]" />
        </div>
      </section>

      <section className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_320px]">
        <div className="dashboard-panel p-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {Array.from({ length: 4 }).map((_, index) => (
              <div
                key={index}
                className="rounded-[1rem] border border-[rgba(255,255,255,0.06)] bg-[rgba(255,255,255,0.04)] p-4"
              >
                <div className="h-3 w-24 rounded-full bg-[rgba(255,255,255,0.08)]" />
                <div className="mt-4 h-8 w-28 rounded-full bg-[rgba(255,255,255,0.08)]" />
                <div className="mt-3 h-3 w-36 rounded-full bg-[rgba(255,255,255,0.05)]" />
              </div>
            ))}
          </div>

          <div className="mt-5 h-[420px] rounded-[1.1rem] border border-[rgba(255,255,255,0.06)] bg-[linear-gradient(180deg,rgba(30,41,59,0.5),rgba(15,23,42,0.38))]" />
        </div>

        <aside className="space-y-4">
          <div className="premium-rail h-[220px] animate-pulse" />
          <div className="premium-block h-[250px] animate-pulse" />
        </aside>
      </section>
    </div>
  )
}
