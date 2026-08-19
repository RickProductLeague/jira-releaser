// ponytail: Next's own route-level loading state. Every wizard step is a plain GET
// navigation, so this fires for all of them — the Jira fetch and the ~5s agent call
// alike — with no client component, no useFormStatus and no spinner library.
// Ceiling: it's one message for both waits, since a route-level fallback can't see
// which step it's covering. Per-step copy would mean a Suspense boundary per section.
export default function Loading() {
  return (
    <main className="mx-auto w-full max-w-5xl p-8 font-sans">
      <h1 className="text-2xl font-semibold">Jira Releaser</h1>
      <p className="mt-6 flex items-center gap-3 text-sm" role="status" aria-live="polite">
        <span
          aria-hidden
          className="inline-block h-4 w-4 animate-spin rounded-full border-2 border-current border-t-transparent opacity-60"
        />
        Fetching from Jira and generating release notes — this can take a few seconds.
      </p>
      <div className="mt-6 space-y-3" aria-hidden>
        {[0, 1, 2, 3].map((i) => (
          <div key={i} className="h-4 animate-pulse rounded bg-black/10 dark:bg-white/10" />
        ))}
      </div>
    </main>
  );
}
