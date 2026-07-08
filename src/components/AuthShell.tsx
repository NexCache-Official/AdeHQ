"use client";

import { Bot, CheckCircle2, Brain, Phone } from "lucide-react";
import { motion } from "framer-motion";
import { BrandLockup } from "@/components/brand/Brand";

const FEATURES = [
  { icon: Bot, text: "Hire AI employees with real roles & tools" },
  { icon: Brain, text: "They remember decisions in project memory" },
  { icon: CheckCircle2, text: "They request approvals before risky actions" },
  { icon: Phone, text: "Jump on simulated calls with your workforce" },
];

export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="flex min-h-screen">
      {/* Left — brand panel */}
      <div className="relative hidden w-[46%] flex-col justify-between overflow-hidden border-r border-slate-200 bg-white p-12 lg:flex">
        <div className="absolute inset-0 -z-10 bg-dots opacity-[0.35] mask-fade-b" />
        <div
          className="absolute -left-24 top-1/3 -z-10 h-72 w-72 rounded-full bg-accent-100 blur-[100px]"
        />
        <div className="absolute -right-10 bottom-10 -z-10 h-64 w-64 rounded-full bg-accent-50 blur-[90px]" />

        <div className="flex justify-center">
          <BrandLockup size={42} />
        </div>

        <div className="max-w-md">
          <motion.h2
            initial={{ opacity: 0, y: 10 }}
            animate={{ opacity: 1, y: 0 }}
            transition={{ duration: 0.5 }}
            className="text-balance text-3xl font-semibold leading-tight tracking-tight text-slate-900"
          >
            Your company&apos;s
            <br />
            AI headquarters.
          </motion.h2>
          <p className="mt-3 text-[15px] leading-relaxed text-slate-600">
            The easiest way to create and manage your AI workforce. Hire AI
            employees, give them tools, and work with them in project rooms.
          </p>

          <div className="mt-8 space-y-3">
            {FEATURES.map((f, i) => (
              <motion.div
                key={f.text}
                initial={{ opacity: 0, x: -8 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ duration: 0.4, delay: 0.15 + i * 0.08 }}
                className="flex items-center gap-3"
              >
                <span className="flex h-9 w-9 items-center justify-center rounded-xl border border-accent-200 bg-accent-50 text-accent-600">
                  <f.icon className="h-4 w-4" />
                </span>
                <span className="text-sm text-slate-600">{f.text}</span>
              </motion.div>
            ))}
          </div>
        </div>

        <div className="flex items-center gap-2 text-xs text-slate-500">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" />
          Supabase-backed workspace · real-time collaboration
        </div>
      </div>

      {/* Right — form */}
      <div className="flex flex-1 items-center justify-center p-6 sm:p-10">
        <motion.div
          initial={{ opacity: 0, y: 12 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: 0.45, ease: [0.16, 1, 0.3, 1] }}
          className="w-full max-w-sm"
        >
          {children}
        </motion.div>
      </div>
    </div>
  );
}
