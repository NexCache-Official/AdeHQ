"use client";

import { useState } from "react";
import { Check, Eye, EyeOff } from "lucide-react";
import { getPasswordStrength } from "@/lib/auth/password";

function PasswordRequirement({ met, children }: { met: boolean; children: React.ReactNode }) {
  return (
    <div className="flex items-center gap-2 text-xs leading-relaxed text-slate-500">
      <span
        className={`flex h-4 w-4 shrink-0 items-center justify-center rounded-full text-[10px] transition ${
          met ? "bg-emerald-500 text-white" : "bg-slate-100 text-slate-400"
        }`}
      >
        {met && <Check className="h-3 w-3" />}
      </span>
      {children}
    </div>
  );
}

export function PasswordStrengthField({
  label,
  value,
  onChange,
  placeholder = "Enter a password",
  showStrength = true,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  placeholder?: string;
  showStrength?: boolean;
  autoFocus?: boolean;
}) {
  const [visible, setVisible] = useState(false);
  const strength = getPasswordStrength(value);

  return (
    <label className="block space-y-1.5">
      <span className="text-xs font-semibold text-slate-500">{label}</span>
      <div className="relative">
        <input
          type={visible ? "text" : "password"}
          className="input-field pr-11"
          placeholder={placeholder}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          autoFocus={autoFocus}
        />
        <button
          type="button"
          aria-label={visible ? "Hide password" : "Show password"}
          className="absolute right-3 top-1/2 -translate-y-1/2 rounded-md p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-700"
          onClick={() => setVisible((v) => !v)}
        >
          {visible ? <EyeOff className="h-4 w-4" /> : <Eye className="h-4 w-4" />}
        </button>
      </div>
      {showStrength && value.length > 0 && (
        <div className="rounded-xl border border-slate-200/80 bg-slate-50/80 px-3 py-2.5">
          <div className="mb-2 flex items-center justify-between gap-3">
            <div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-200">
              <div
                className="h-full rounded-full bg-gradient-to-r from-accent-500 to-emerald-500 transition-all duration-300"
                style={{ width: `${strength.percent}%` }}
              />
            </div>
            <span className="text-[11px] font-medium text-slate-500">{strength.label}</span>
          </div>
          <div className="space-y-1.5">
            <PasswordRequirement met={strength.hasLength}>At least 8 characters</PasswordRequirement>
            <PasswordRequirement met={strength.hasMix}>Mix of letters, numbers, and symbols</PasswordRequirement>
            <PasswordRequirement met={strength.hasNoObviousPattern}>No obvious patterns</PasswordRequirement>
          </div>
        </div>
      )}
    </label>
  );
}
