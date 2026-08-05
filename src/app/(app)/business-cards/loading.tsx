export default function BusinessCardsLoading() {
  return (
    <div className="max-w-6xl mx-auto px-4 md:px-6 lg:px-8 pt-4 md:pt-6 pb-24 md:pb-10 animate-pulse">
      {/* Header */}
      <div className="mb-5 space-y-2">
        <div className="h-2.5 w-24 rounded bg-line-2" />
        <div className="h-7 w-52 rounded bg-line-2" />
        <div className="h-3 w-80 rounded bg-line-2" />
      </div>

      {/* Toolbar */}
      <div className="flex flex-wrap items-center gap-2 mb-4">
        <div className="h-10 w-64 rounded-xl bg-line-2" />
        <div className="h-10 w-24 rounded-xl bg-line-2" />
        <div className="ml-auto h-9 w-32 rounded-lg bg-line-2" />
      </div>

      {/* Cards */}
      <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-2 md:gap-3">
        {Array.from({ length: 6 }).map((_, i) => (
          <div key={i} className="h-32 rounded-xl bg-panel border border-line" />
        ))}
      </div>
    </div>
  );
}
