"use client";

import { useState, type ReactNode } from "react";
import Link from "next/link";
import { cn } from "@/lib/utils";

export type AuthScene = "signin" | "signup" | "verify" | "createWorkspace";

const SCENE_COPY: Record<
  AuthScene,
  { eyebrow: string; headline: string; subhead: string }
> = {
  signin: {
    eyebrow: "Welcome back",
    headline: "Your workforce never clocks out.",
    subhead: "Sign back in and see what shipped while you were away.",
  },
  signup: {
    eyebrow: "Get started",
    headline: "Hire your first AI employee.",
    subhead: "Describe the role — Ade Recruiter handles sourcing, briefing, and onboarding.",
  },
  verify: {
    eyebrow: "Almost there",
    headline: "One click from live.",
    subhead: "Confirm your email and your workspace switches on instantly.",
  },
  createWorkspace: {
    eyebrow: "New headquarters",
    headline: "Spin up another workspace.",
    subhead: "Same rules, fresh rooms — onboard this HQ before your team moves in.",
  },
};

const CHIPS = [
  {
    label: "En",
    pos: "left-1.5 top-1.5",
    tone: "bg-gradient-to-br from-indigo-500 to-indigo-600",
    anim: "animate-[lgFloatA_5s_ease-in-out_infinite]",
    parallax: [-16, -16] as const,
  },
  {
    label: "Sa",
    pos: "right-0.5 top-[26px]",
    tone: "bg-gradient-to-br from-rose-400 to-orange-400",
    anim: "animate-[lgFloatB_6s_ease-in-out_infinite]",
    parallax: [18, -10] as const,
  },
  {
    label: "Mk",
    pos: "bottom-0 left-[26px]",
    tone: "bg-gradient-to-br from-emerald-400 to-teal-500",
    anim: "animate-[lgFloatC_4.5s_ease-in-out_infinite]",
    parallax: [-12, 14] as const,
  },
  {
    label: "Pr",
    pos: "bottom-3.5 right-[22px]",
    tone: "bg-gradient-to-br from-violet-500 to-purple-500",
    anim: "animate-[lgFloatA_5.5s_ease-in-out_infinite]",
    parallax: [14, 16] as const,
  },
];

export function AuthModeTabs({
  mode,
  nextPath,
}: {
  mode: "signin" | "signup";
  nextPath?: string | null;
}) {
  const qs = nextPath ? `?next=${encodeURIComponent(nextPath)}` : "";
  return (
    <div className="mb-[26px] flex rounded-[12px] bg-[#111113]/[0.06] p-1">
      {(
        [
          { value: "signin" as const, label: "Sign in", href: `/login${qs}` },
          { value: "signup" as const, label: "Sign up", href: `/signup${qs}` },
        ] as const
      ).map((item) => {
        const active = item.value === mode;
        return (
          <Link
            key={item.value}
            href={item.href}
            className={cn(
              "flex h-10 flex-1 items-center justify-center rounded-[10px] text-[13.5px] font-semibold transition-colors",
              active
                ? "bg-white text-[#111113] shadow-sm"
                : "text-[#111113]/55 hover:text-[#111113]",
            )}
          >
            {item.label}
          </Link>
        );
      })}
    </div>
  );
}

export function AuthShell({
  children,
  scene = "signin",
}: {
  children: ReactNode;
  scene?: AuthScene;
}) {
  const copy = SCENE_COPY[scene];
  const [mx, setMx] = useState(0);
  const [my, setMy] = useState(0);

  return (
    <div className="grid min-h-screen bg-white font-sans text-[#111113] lg:grid-cols-[min(480px,42vw)_1fr]">
      {/* Left — form panel */}
      <div className="relative flex min-h-screen flex-col px-6 py-10 sm:px-12 lg:px-12">
        <Link href="/login" className="inline-flex items-center gap-2.5">
          <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-lg bg-[#111113] text-[15px] font-bold tracking-tight text-white">
            A
          </span>
          <span className="text-base font-semibold tracking-tight">AdeHQ</span>
        </Link>

        <div className="flex flex-1 items-center justify-center py-10">
          <div className="w-full max-w-[340px] animate-[lgFadeUp_0.5s_cubic-bezier(0.2,0.7,0.3,1)_both]">
            {children}
          </div>
        </div>

        <p className="text-xs text-[#111113]/45">
          By continuing you agree to AdeHQ&apos;s Terms &amp; Privacy Policy.
        </p>
      </div>

      {/* Right — live scene */}
      <div
        className="relative hidden min-h-screen flex-col justify-between gap-5 overflow-x-hidden overflow-y-auto bg-[#0c0c0e] px-9 py-9 text-white lg:flex xl:px-[52px]"
        onMouseMove={(e) => {
          const r = e.currentTarget.getBoundingClientRect();
          setMx(((e.clientX - r.left) / r.width) * 2 - 1);
          setMy(((e.clientY - r.top) / r.height) * 2 - 1);
        }}
        onMouseLeave={() => {
          setMx(0);
          setMy(0);
        }}
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -left-[140px] -top-[160px] h-[520px] w-[520px] rounded-full bg-[radial-gradient(circle,#6366F1,transparent_70%)] opacity-35 blur-[60px] animate-[lgAurora_14s_ease-in-out_infinite]"
        />
        <div
          aria-hidden
          className="pointer-events-none absolute -bottom-[200px] -right-[160px] h-[560px] w-[560px] rounded-full bg-[radial-gradient(circle,#22D3EE,transparent_70%)] opacity-28 blur-[70px] animate-[lgAurora_16s_ease-in-out_infinite_reverse]"
        />

        <div
          key={scene}
          className="relative z-10 animate-[lgFadeUp_0.55s_cubic-bezier(0.2,0.7,0.3,1)_both]"
        >
          <div className="mb-[22px] inline-flex items-center gap-[7px] rounded-full border border-white/14 px-3 py-[5px] font-mono text-[10.5px] uppercase tracking-[0.07em] text-white/60">
            <span className="h-1.5 w-1.5 rounded-full bg-[#22D3EE] shadow-[0_0_0_3px_rgba(34,211,238,0.2)]" />
            {copy.eyebrow}
          </div>
          <h2 className="m-0 max-w-[460px] text-[32px] font-semibold leading-[1.1] tracking-[-0.03em] text-white">
            {copy.headline}
          </h2>
          <p className="mt-2.5 max-w-[400px] text-[14.5px] leading-relaxed text-white/55">
            {copy.subhead}
          </p>
        </div>

        <div className="relative z-10 flex min-h-[150px] items-center justify-center">
          <div className="relative h-[150px] w-[260px]">
            <div
              className="absolute left-1/2 top-1/2 h-24 w-24 -translate-x-1/2 -translate-y-1/2 rounded-[32px] bg-[linear-gradient(140deg,#6366F1,#22D3EE)] shadow-[0_20px_50px_-14px_rgba(99,102,241,0.55)] transition-transform duration-200 ease-out"
              style={{ transform: `translate(calc(-50% + ${mx * 8}px), calc(-50% + ${my * 8}px))` }}
            />
            {CHIPS.map((chip) => (
              <div
                key={chip.label}
                className={cn("absolute transition-transform duration-200 ease-out", chip.pos)}
                style={{
                  transform: `translate(${chip.parallax[0] * mx}px, ${chip.parallax[1] * my}px)`,
                }}
              >
                <div
                  className={cn(
                    "flex h-[46px] w-[46px] items-center justify-center rounded-[14px] font-mono text-xs font-semibold text-white shadow-[0_10px_24px_-10px_rgba(0,0,0,0.5)]",
                    chip.tone,
                    chip.anim,
                  )}
                >
                  {chip.label}
                </div>
              </div>
            ))}
          </div>
        </div>

        <div className="relative z-10 max-w-[400px] rounded-[18px] border border-white/10 bg-white/[0.06] px-[22px] py-[18px] backdrop-blur-[14px]">
          <p className="m-0 font-serif text-[15.5px] italic leading-[1.45] text-white">
            &quot;Our AI account manager drafted, sent, and followed up on forty client emails before
            I&apos;d finished my coffee.&quot;
          </p>
          <div className="mt-3 flex items-center gap-[9px]">
            <span className="h-[26px] w-[26px] shrink-0 rounded-full bg-gradient-to-br from-violet-500 to-indigo-500" />
            <span className="text-[12.5px] text-white/55">Early workspace owner</span>
          </div>
        </div>
      </div>
    </div>
  );
}
