import Link from "next/link";
import { BrandLockup, BrandMark } from "@/components/brand/Brand";

export const metadata = {
  title: "404 — Page not found · AdeHQ",
};

const LOST_BADGES = [
  { label: "Maya", tone: "from-sky-400 to-accent", delay: "0s", x: "6%", y: "16%" },
  { label: "Casey", tone: "from-emerald-400 to-teal-500", delay: "0.35s", x: "82%", y: "20%" },
  { label: "Jules", tone: "from-amber-400 to-orange-500", delay: "0.7s", x: "10%", y: "74%" },
  { label: "Lane", tone: "from-rose-400 to-pink-500", delay: "1.05s", x: "76%", y: "70%" },
] as const;

export default function NotFoundPage() {
  return (
    <div className="relative min-h-screen overflow-hidden bg-canvas font-sans text-ink">
      <div
        aria-hidden
        className="pointer-events-none absolute -left-32 -top-40 h-[28rem] w-[28rem] rounded-full bg-[radial-gradient(circle,rgb(var(--c-accent)/0.22),transparent_68%)] blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute -bottom-48 -right-24 h-[32rem] w-[32rem] rounded-full bg-[radial-gradient(circle,rgb(var(--c-accent-2)/0.18),transparent_70%)] blur-3xl"
      />
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 opacity-[0.35]"
        style={{
          backgroundImage: "radial-gradient(rgb(var(--c-ink) / 0.06) 1px, transparent 1px)",
          backgroundSize: "22px 22px",
        }}
      />

      <div aria-hidden className="pointer-events-none absolute inset-0">
        {LOST_BADGES.map((badge) => (
          <div
            key={badge.label}
            className="absolute animate-[obdFloat_5.5s_ease-in-out_infinite]"
            style={{
              left: badge.x,
              top: badge.y,
              animationDelay: badge.delay,
            }}
          >
            <div
              className={`flex h-12 w-12 items-center justify-center rounded-2xl bg-gradient-to-br ${badge.tone} text-[11px] font-bold text-white shadow-[0_12px_28px_-12px_rgba(15,23,42,0.45)] ring-2 ring-white/70`}
            >
              {badge.label.slice(0, 2)}
            </div>
          </div>
        ))}
      </div>

      <div className="relative z-10 mx-auto flex min-h-screen max-w-3xl flex-col px-6 py-10 sm:px-10">
        <Link href="/" className="inline-flex w-fit items-center" aria-label="AdeHQ home">
          <BrandLockup size={32} />
        </Link>

        <main className="flex flex-1 flex-col items-center justify-center py-16 text-center animate-[lgFadeUp_0.55s_cubic-bezier(0.2,0.7,0.3,1)_both]">
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-surface/90 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.08em] text-ink-3 shadow-sm">
            <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
            Status · missing from the org chart
          </div>

          <p className="font-mono text-[13px] font-medium uppercase tracking-[0.14em] text-accent">
            Error 404
          </p>

          <h1 className="mt-3 max-w-xl text-[clamp(2.4rem,7vw,4.25rem)] font-extrabold leading-[1.05] tracking-[-0.04em] text-ink">
            This page clocked out
            <span className="text-accent">.</span>
          </h1>

          <p className="mt-5 max-w-md text-[16px] leading-relaxed text-ink-2">
            Our AI employees checked every room, DM, and Drive folder. Nobody filed a ticket for{" "}
            <span className="font-medium text-ink">this URL</span>. Either it never got hired — or it
            quit without notice.
          </p>

          <div className="relative mt-10 flex h-40 w-full max-w-sm items-center justify-center">
            <div className="absolute inset-x-6 bottom-5 h-[4.5rem] rounded-[32px] bg-gradient-to-b from-muted to-border/80 shadow-inner" />
            <div className="absolute bottom-16 left-1/2 h-[5.5rem] w-[5.5rem] -translate-x-1/2 rounded-[24px] bg-surface shadow-[0_18px_40px_-18px_rgba(47,111,237,0.55)] ring-1 ring-border animate-[obdFloat_4.8s_ease-in-out_infinite]">
              <div className="flex h-full items-center justify-center">
                <BrandMark size={42} nativeColor />
              </div>
              <div className="absolute -right-2 -top-2 flex h-7 w-7 items-center justify-center rounded-full bg-ink font-mono text-[11px] font-bold text-white shadow-md">
                ?
              </div>
            </div>
            <p className="absolute bottom-0 font-mono text-[10px] uppercase tracking-[0.12em] text-ink-3">
              Desk reserved · occupant unknown
            </p>
          </div>

          <div className="mt-10 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/"
              className="inline-flex h-11 items-center justify-center rounded-xl bg-accent px-5 text-sm font-semibold text-white shadow-[0_10px_24px_-12px_rgba(47,111,237,0.7)] transition hover:bg-accent-d"
            >
              Back to headquarters
            </Link>
            <Link
              href="/login"
              className="inline-flex h-11 items-center justify-center rounded-xl border border-border bg-surface px-5 text-sm font-semibold text-ink transition hover:border-ink/25"
            >
              Sign in
            </Link>
          </div>

          <p className="mt-8 max-w-sm font-mono text-[11px] leading-relaxed text-ink-3">
            Looking for a confirmation link? Those open at{" "}
            <span className="text-ink-2">/auth/callback</span> — if it failed, request a fresh email
            from sign-in.
          </p>
        </main>
      </div>
    </div>
  );
}
