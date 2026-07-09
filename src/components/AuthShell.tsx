"use client";

import { motion } from "framer-motion";
import Link from "next/link";
import { BrandLockup, BrandMark } from "@/components/brand/Brand";

const AGENT_CHIPS = [
  { label: "Ops", className: "left-6 top-7 bg-[#2f6fed]" },
  { label: "CRM", className: "right-8 top-10 bg-[#21b89d]" },
  { label: "Hire", className: "bottom-8 left-10 bg-[#111113]" },
  { label: "Mail", className: "bottom-6 right-4 bg-[#6b7cff]" },
];

export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen bg-[#f7f6f2] text-[var(--ink)] lg:grid-cols-[minmax(420px,470px)_1fr]">
      <div className="flex min-h-screen flex-col bg-gradient-to-b from-white to-[#fbfaf7] px-6 py-7 sm:px-10 lg:px-12">
        <Link href="/login" className="inline-flex w-fit">
          <BrandLockup size={38} />
        </Link>
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          className="flex flex-1 items-center justify-center py-10"
        >
          <div className="w-full max-w-[380px]">{children}</div>
        </motion.div>
        <p className="text-xs leading-relaxed text-slate-400">
          By continuing you agree to AdeHQ&apos;s Terms and Privacy Policy.
        </p>
      </div>

      <div className="relative hidden min-h-screen flex-col justify-between overflow-hidden bg-[#101114] px-12 py-10 text-white lg:flex xl:px-14">
        <motion.div
          aria-hidden
          className="absolute -left-40 -top-44 h-[34rem] w-[34rem] rounded-full bg-[#4568ff]/30 blur-[72px]"
          animate={{ x: [0, 24, 0], y: [0, -18, 0], scale: [1, 1.08, 1] }}
          transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          aria-hidden
          className="absolute -bottom-56 -right-44 h-[37rem] w-[37rem] rounded-full bg-[#22c7a9]/25 blur-[80px]"
          animate={{ x: [0, -22, 0], y: [0, 16, 0], scale: [1.04, 1, 1.04] }}
          transition={{ duration: 16, repeat: Infinity, ease: "easeInOut" }}
        />
        <div className="absolute inset-0 bg-[linear-gradient(120deg,rgba(255,255,255,0.08),transparent_34%,rgba(78,201,176,0.08))]" />

        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.55, ease: [0.2, 0.7, 0.3, 1] }}
          className="relative z-10"
        >
          <div className="mb-6 inline-flex items-center gap-2 rounded-full border border-white/15 px-3 py-1.5 font-mono text-[10.5px] uppercase tracking-[0.07em] text-white/65">
            <span className="h-1.5 w-1.5 rounded-full bg-[#35dec0] shadow-[0_0_0_4px_rgba(53,222,192,0.16)]" />
            AI workforce online
          </div>
          <h2 className="max-w-lg text-balance text-4xl font-semibold leading-[1.06] tracking-[-0.04em] text-white">
            Your company&apos;s AI headquarters.
          </h2>
          <p className="mt-3 max-w-md text-[15px] leading-relaxed text-white/60">
            Sign in, launch a workspace, and let your AI employees keep moving work across rooms,
            memory, approvals, and tools.
          </p>
        </motion.div>

        <div className="relative z-10 flex min-h-[280px] items-center justify-center">
          <div className="relative h-[240px] w-[320px]">
            <motion.div
              className="absolute inset-3 rounded-full border border-white/15"
              animate={{ rotate: 360 }}
              transition={{ duration: 24, repeat: Infinity, ease: "linear" }}
            />
            <motion.div
              className="absolute left-1/2 top-1/2 flex h-[118px] w-[118px] -translate-x-1/2 -translate-y-1/2 items-center justify-center overflow-hidden rounded-[31px] bg-white text-accent shadow-[0_28px_70px_-20px_rgba(0,0,0,0.65)] ring-1 ring-white/20"
              animate={{ y: [0, -8, 0], rotate: [0, 1.5, 0] }}
              transition={{ duration: 5.5, repeat: Infinity, ease: "easeInOut" }}
            >
              <motion.span
                aria-hidden
                className="absolute inset-x-[-70%] inset-y-[-80%] bg-[linear-gradient(180deg,transparent,rgba(47,111,237,0.22),transparent)]"
                animate={{ y: ["-45%", "45%"] }}
                transition={{ duration: 3.6, repeat: Infinity, ease: "easeInOut" }}
              />
              <BrandMark size={78} className="relative z-10 text-accent" />
            </motion.div>
            {AGENT_CHIPS.map((chip, index) => (
              <motion.div
                key={chip.label}
                className={`absolute flex h-[54px] w-[54px] items-center justify-center rounded-[17px] font-mono text-xs font-semibold text-white shadow-[0_16px_30px_-14px_rgba(0,0,0,0.7)] ${chip.className}`}
                animate={{ y: [0, index % 2 === 0 ? -10 : 10, 0], x: [0, index % 2 === 0 ? 5 : -7, 0] }}
                transition={{ duration: 5 + index * 0.5, repeat: Infinity, ease: "easeInOut" }}
              >
                {chip.label}
              </motion.div>
            ))}
          </div>
        </div>

        <motion.div
          initial={{ opacity: 0, y: 18 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.7, ease: [0.2, 0.7, 0.3, 1] }}
          className="relative z-10 max-w-md rounded-[18px] border border-white/10 bg-white/[0.065] px-5 py-4 backdrop-blur"
        >
          <p className="font-serif text-base italic leading-relaxed text-white">
            &quot;AdeHQ feels like a room full of people already moving work forward.&quot;
          </p>
          <div className="mt-4 flex items-center gap-2.5">
            <span className="flex h-8 w-8 items-center justify-center rounded-[10px] bg-white text-accent">
              <BrandMark size={20} />
            </span>
            <span className="text-xs text-white/55">Workspace owner</span>
          </div>
        </motion.div>
      </div>
    </div>
  );
}
