"use client";

import { LayoutGrid } from "lucide-react";

type OnboardingOrgGraphProps = {
  ownerInitial: string;
  roomName: string;
  hireName: string;
  showRoom: boolean;
  showMaya: boolean;
  showHire: boolean;
  connectYouRoom: boolean;
  connectYouMaya: boolean;
  connectRoomHire: boolean;
  connectMayaRoom: boolean;
};

export function OnboardingOrgGraph({
  ownerInitial,
  roomName,
  hireName,
  showRoom,
  showMaya,
  showHire,
  connectYouRoom,
  connectYouMaya,
  connectRoomHire,
  connectMayaRoom,
}: OnboardingOrgGraphProps) {
  return (
    <div className="relative z-[2] flex min-h-0 flex-1 items-center justify-center">
      <div className="obd-float relative h-[210px] w-[300px]">
        <svg
          viewBox="0 0 300 210"
          className="pointer-events-none absolute inset-0 h-[210px] w-[300px] overflow-visible"
          aria-hidden
        >
          {connectYouRoom && (
            <line x1="150" y1="40" x2="78" y2="120" stroke="rgba(255,255,255,.32)" strokeWidth="1.6" />
          )}
          {connectYouMaya && (
            <line x1="150" y1="40" x2="222" y2="116" stroke="rgba(34,211,238,.45)" strokeWidth="1.6" />
          )}
          {connectRoomHire && (
            <line
              x1="78"
              y1="120"
              x2="150"
              y2="180"
              stroke="rgba(255,255,255,.24)"
              strokeWidth="1.4"
              strokeDasharray="5 6"
            />
          )}
          {connectMayaRoom && (
            <line
              x1="222"
              y1="116"
              x2="78"
              y2="120"
              stroke="rgba(255,255,255,.14)"
              strokeWidth="1.2"
              strokeDasharray="3 6"
            />
          )}
        </svg>

        {/* You */}
        <div className="absolute left-1/2 top-10 flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1.5 text-center">
          <div className="flex h-[52px] w-[52px] items-center justify-center rounded-[15px] border border-white/20 bg-gradient-to-br from-slate-600 to-slate-800 text-[17px] font-extrabold text-white shadow-[0_10px_26px_-8px_rgba(0,0,0,.6)]">
            {ownerInitial}
          </div>
          <div className="flex flex-col gap-px">
            <span className="text-xs font-bold">You</span>
            <span className="text-[10px] text-white/50">Admin</span>
          </div>
        </div>

        {/* Room */}
        {showRoom && (
          <div className="obd-pop-node absolute left-[78px] top-[120px] flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1.5 text-center">
            <div
              className="flex h-[46px] w-[46px] items-center justify-center rounded-[14px] border border-[color-mix(in_srgb,var(--accent)_70%,transparent)] bg-[color-mix(in_srgb,var(--accent)_22%,#0B0D12)] shadow-[0_8px_22px_-8px_color-mix(in_srgb,var(--accent)_60%,transparent)]"
            >
              <LayoutGrid className="h-[22px] w-[22px] text-[var(--accent)]" strokeWidth={1.9} />
            </div>
            <div className="flex max-w-[120px] flex-col gap-px">
              <span className="truncate text-[11.5px] font-bold">{roomName}</span>
              <span className="text-[9.5px] text-white/50">Room</span>
            </div>
          </div>
        )}

        {/* Maya */}
        {showMaya && (
          <div className="obd-pop-node absolute left-[222px] top-[116px] flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1.5 text-center">
            <div className="relative h-12 w-12">
              <div className="obd-maya-ring absolute left-1/2 top-1/2 h-12 w-12 rounded-full border-2 border-cyan-400/60" />
              <div className="absolute inset-0 flex items-center justify-center rounded-full border border-white/25 bg-gradient-to-br from-cyan-400 to-emerald-600 text-[17px] font-extrabold text-white shadow-[0_8px_24px_-6px_rgba(34,211,238,.55)]">
                M
              </div>
            </div>
            <div className="flex flex-col gap-px">
              <span className="text-[11.5px] font-bold">Maya</span>
              <span className="text-[9.5px] text-white/50">Workforce Manager</span>
            </div>
          </div>
        )}

        {/* First hire */}
        {showHire && (
          <div className="obd-pop-node absolute left-1/2 top-[180px] flex -translate-x-1/2 -translate-y-1/2 flex-col items-center gap-1 text-center">
            <div className="flex h-[42px] w-[42px] items-center justify-center rounded-xl border border-dashed border-white/40 bg-white/[0.04] text-[22px] font-light text-white/60">
              +
            </div>
            <div className="flex max-w-[150px] flex-col gap-px">
              <span className="truncate text-[11px] font-semibold text-white/82">{hireName}</span>
              <span className="text-[9.5px] text-white/42">Suggested first hire</span>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
