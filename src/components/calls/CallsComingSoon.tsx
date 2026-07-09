"use client";

import Link from "next/link";
import { motion } from "framer-motion";
import { BrandMark } from "@/components/brand/Brand";
import { PageContainer } from "@/components/Page";
import { cn } from "@/lib/utils";
import {
  ArrowLeft,
  Clock,
  ListChecks,
  Mic,
  PhoneCall,
  Sparkles,
  Users,
} from "lucide-react";

const PREVIEW = [
  {
    icon: Mic,
    title: "Live voice with your AI team",
    body: "Join a room call with humans and AI employees — same workspace, same context.",
  },
  {
    icon: Users,
    title: "Room-aware participants",
    body: "Invite the employees already assigned to a project room. Everyone hears the same plan.",
  },
  {
    icon: ListChecks,
    title: "Transcript & action items",
    body: "Calls produce a live transcript, suggested follow-ups, and tasks you can approve.",
  },
  {
    icon: Sparkles,
    title: "Memory that sticks",
    body: "Decisions from calls flow into project memory so nothing gets lost after you hang up.",
  },
];

export function CallsComingSoon() {
  return (
    <PageContainer wide>
      <div className="relative overflow-hidden rounded-[28px] border border-border bg-gradient-to-br from-[#0f1117] via-[#151a24] to-[#10141c] px-6 py-10 text-white sm:px-10 sm:py-12">
        <motion.div
          aria-hidden
          className="pointer-events-none absolute -left-32 -top-32 h-80 w-80 rounded-full bg-accent/30 blur-[90px]"
          animate={{ x: [0, 24, 0], y: [0, -16, 0] }}
          transition={{ duration: 14, repeat: Infinity, ease: "easeInOut" }}
        />
        <motion.div
          aria-hidden
          className="pointer-events-none absolute -bottom-40 -right-24 h-96 w-96 rounded-full bg-emerald-500/20 blur-[100px]"
          animate={{ x: [0, -20, 0], y: [0, 18, 0] }}
          transition={{ duration: 16, repeat: Infinity, ease: "easeInOut" }}
        />

        <div className="relative z-10 mx-auto max-w-3xl text-center">
          <div className="mb-5 inline-flex items-center gap-2 rounded-full border border-white/15 bg-white/10 px-3 py-1.5 text-[11px] font-semibold uppercase tracking-[0.08em] text-white/80">
            <Clock className="h-3.5 w-3.5 text-amber-300" />
            Coming soon
          </div>

          <div className="mx-auto mb-6 flex h-[88px] w-[88px] items-center justify-center rounded-[26px] bg-white text-accent shadow-[0_24px_60px_-20px_rgba(0,0,0,0.65)] ring-1 ring-white/20">
            <BrandMark size={52} />
          </div>

          <h1 className="text-balance text-3xl font-semibold tracking-[-0.04em] sm:text-4xl">
            Workforce calls are on the way.
          </h1>
          <p className="mx-auto mt-3 max-w-xl text-[15px] leading-relaxed text-white/60">
            Voice sessions with your AI employees — live transcript, action items, and memory — are
            in development. For now, use project rooms and DMs to collaborate.
          </p>

          <div className="mt-8 flex flex-wrap items-center justify-center gap-3">
            <Link
              href="/rooms"
              className={cn(
                "inline-flex h-10 items-center justify-center gap-2 rounded-xl border border-white/20 bg-white/10 px-4 text-sm font-medium text-white transition-all hover:bg-white/15",
              )}
            >
              <Users className="h-4 w-4" />
              Open a room
            </Link>
            <Link
              href="/workforce"
              className={cn(
                "inline-flex h-10 items-center justify-center gap-2 rounded-xl bg-white px-4 text-sm font-medium text-ink transition-all hover:bg-white/90",
              )}
            >
              <PhoneCall className="h-4 w-4" />
              View workforce
            </Link>
          </div>
        </div>
      </div>

      <div className="mt-8 grid gap-4 sm:grid-cols-2">
        {PREVIEW.map((item, i) => {
          const Icon = item.icon;
          return (
            <motion.div
              key={item.title}
              initial={{ opacity: 0, y: 12 }}
              animate={{ opacity: 1, y: 0 }}
              transition={{ delay: 0.08 * i, duration: 0.4 }}
              className="rounded-2xl border border-border bg-surface p-5"
            >
              <span className="mb-3 flex h-10 w-10 items-center justify-center rounded-xl bg-accent-soft text-accent">
                <Icon className="h-5 w-5" />
              </span>
              <h2 className="text-sm font-semibold text-ink">{item.title}</h2>
              <p className="mt-1.5 text-sm leading-relaxed text-ink-3">{item.body}</p>
            </motion.div>
          );
        })}
      </div>

      <p className="mt-8 text-center text-xs text-ink-3">
        Simulated call demos are disabled so they won&apos;t write to memory or your work log.
      </p>

      <div className="mt-4 flex justify-center">
        <Link
          href="/"
          className="inline-flex items-center gap-2 text-sm font-medium text-ink-2 transition-colors hover:text-ink"
        >
          <ArrowLeft className="h-4 w-4" />
          Back to HQ
        </Link>
      </div>
    </PageContainer>
  );
}
