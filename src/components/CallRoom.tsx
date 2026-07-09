"use client";

import { useEffect, useRef, useState } from "react";
import { Call, CallParticipant } from "@/lib/types";
import { WORKFORCE_CALLS_ENABLED } from "@/lib/config/features";
import { useStore } from "@/lib/demo-store";
import { EmployeeAvatar, HumanAvatar } from "./EmployeeAvatar";
import { Button } from "./ui";
import { cn, formatTime, uid, nowISO } from "@/lib/utils";
import {
  ListChecks,
  Mic,
  MicOff,
  PhoneOff,
  Sparkles,
  Video,
} from "lucide-react";
import { AnimatePresence, motion } from "framer-motion";

type ScriptLine = { speakerId: string; text: string };

const CALL_SCRIPTS: Record<string, string[]> = {
  research: ["The clearest wedge is indie devs building Godot prototypes.", "I'll pull the latest competitor data before our next sync."],
  pm: ["I recommend a one-week sprint focused on the demo and landing page.", "I'll turn this into tasks and request approval on the roadmap."],
  engineering: ["I can break this into implementation tasks.", "I'll need GitHub write access to open the PRs."],
  design: ["I'll keep the surface calm — one primary action per screen.", "I'll review the flows and leave notes in memory."],
  marketing: ["I'll draft the launch thread and landing copy.", "I'll hold the email until you approve it."],
  gamedev: ["I'll scope the smallest fun prototype and start in Godot.", "I'll add juice once the core loop feels right."],
};

function roleFromName(name: string): keyof typeof CALL_SCRIPTS {
  const k = name.toLowerCase();
  if (k.includes("research")) return "research";
  if (k.includes("game")) return "gamedev";
  if (k.includes("eng")) return "engineering";
  if (k.includes("design")) return "design";
  if (k.includes("market")) return "marketing";
  if (k.includes("pm") || k.includes("product")) return "pm";
  return "pm";
}

function buildScript(participants: CallParticipant[]): ScriptLine[] {
  const host = participants.find((p) => p.type === "human");
  const ai = participants.filter((p) => p.type === "ai");
  const lines: ScriptLine[] = [];
  if (host) lines.push({ speakerId: host.id, text: "What should we build this week?" });
  ai.forEach((p) => {
    lines.push({ speakerId: p.id, text: CALL_SCRIPTS[roleFromName(p.name)][0] });
  });
  if (host) lines.push({ speakerId: host.id, text: "Love it. Let's lock the plan and get going." });
  ai.slice(0, 2).forEach((p) => {
    lines.push({ speakerId: p.id, text: CALL_SCRIPTS[roleFromName(p.name)][1] });
  });
  return lines;
}

const ACTION_ITEMS = [
  "Finalize the prototype scope",
  "Build the playable demo",
  "Write the launch page",
  "Create a comparison memo",
  "Invite 10 testers",
];

export function CallRoom({ call, onEnd }: { call: Call; onEnd: () => void }) {
  if (!WORKFORCE_CALLS_ENABLED) {
    return <CallRoomDisabled onEnd={onEnd} />;
  }
  return <CallRoomLive call={call} onEnd={onEnd} />;
}

function CallRoomDisabled({ onEnd }: { onEnd: () => void }) {
  const dismissedRef = useRef(false);
  useEffect(() => {
    if (!dismissedRef.current) {
      dismissedRef.current = true;
      onEnd();
    }
  }, [onEnd]);
  return null;
}

function CallRoomLive({ call, onEnd }: { call: Call; onEnd: () => void }) {
  const { actions } = useStore();
  const [transcript, setTranscript] = useState(call.transcript);
  const [speaking, setSpeaking] = useState<string | null>(null);
  const [actionItems, setActionItems] = useState<string[]>(call.actionItems);
  const [muted, setMuted] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [finished, setFinished] = useState(false);
  const transcriptEndRef = useRef<HTMLDivElement>(null);

  const script = useRef(buildScript(call.participants)).current;

  // timer
  useEffect(() => {
    const t = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // play scripted transcript
  useEffect(() => {
    let cancelled = false;
    let i = 0;
    const timers: ReturnType<typeof setTimeout>[] = [];

    const playNext = () => {
      if (cancelled) return;
      if (i >= script.length) {
        setSpeaking(null);
        // reveal action items progressively
        ACTION_ITEMS.forEach((item, idx) => {
          timers.push(
            setTimeout(() => {
              if (!cancelled) {
                setActionItems((prev) => (prev.includes(item) ? prev : [...prev, item]));
                actions.addActionItem(call.id, item);
              }
            }, 600 * (idx + 1)),
          );
        });
        timers.push(setTimeout(() => !cancelled && setFinished(true), 600 * (ACTION_ITEMS.length + 1)));
        return;
      }
      const line = script[i];
      setSpeaking(line.speakerId);
      const participant = call.participants.find((p) => p.id === line.speakerId);
      const entry = {
        id: uid("tr"),
        speakerId: line.speakerId,
        speakerName: participant?.name ?? "Speaker",
        text: line.text,
        createdAt: nowISO(),
      };
      setTranscript((prev) => [...prev, entry]);
      actions.addTranscriptLine(call.id, entry);
      i += 1;
      timers.push(setTimeout(playNext, 2600));
    };

    timers.push(setTimeout(playNext, 1200));
    return () => {
      cancelled = true;
      timers.forEach(clearTimeout);
    };
  }, [actions, call.id, call.participants, script]);

  useEffect(() => {
    transcriptEndRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [transcript.length]);

  const endCall = () => {
    // persist transcript + action items, create summary memory + tasks
    const items = actionItems.length ? actionItems : ACTION_ITEMS;
    actions.createMemory({
      roomId: call.roomId,
      title: `Call summary: ${call.title}`,
      content: `Discussed the weekly plan. Agreed to ${items.slice(0, 3).join(", ")}, and more. ${call.participants.length} participants.`,
      type: "decision",
      status: "approved",
      createdByType: "system",
      createdById: "system",
    });
    items.slice(0, 3).forEach((item) =>
      actions.createTask({
        roomId: call.roomId,
        title: item,
        status: "open",
        priority: "medium",
        assigneeType: "ai",
        assigneeId: call.participants.find((p) => p.type === "ai")?.id ?? "",
        createdFrom: "Call action items",
      }),
    );
    actions.addWorkLog({
      roomId: call.roomId,
      employeeId: call.participants.find((p) => p.type === "ai")?.id ?? "",
      action: "Joined call",
      summary: `${call.title} — saved summary and ${Math.min(3, items.length)} action items.`,
      status: "success",
      relatedEntityType: "memory",
    });
    actions.endCall(call.id);
    onEnd();
  };

  const fmt = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;
  const activeSpeaker = call.participants.find((p) => p.id === speaking);

  return (
    <div className="flex h-full flex-col gap-4 lg:flex-row">
      {/* Stage */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="mb-3 flex items-center justify-between">
          <div>
            <h2 className="text-lg font-semibold text-slate-900">{call.title}</h2>
            <div className="flex items-center gap-2 text-xs text-slate-500">
              <span className="flex items-center gap-1.5">
                <span className="h-2 w-2 animate-pulse rounded-full bg-rose-500" /> Live
              </span>
              <span>·</span>
              <span>{fmt(elapsed)}</span>
              <span>·</span>
              <span>{call.participants.length} participants</span>
            </div>
          </div>
        </div>

        {/* Active speaker */}
        <div className="relative flex flex-1 items-center justify-center overflow-hidden rounded-2xl border border-slate-200 bg-slate-50">
          <div className="absolute inset-0 bg-mesh opacity-40" />
          <AnimatePresence mode="wait">
            <motion.div
              key={activeSpeaker?.id ?? "idle"}
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              className="relative z-10 flex flex-col items-center gap-4"
            >
              {activeSpeaker ? (
                <div className="relative">
                  <div className={cn("absolute inset-0 -z-10 rounded-full blur-2xl", "animate-pulse")} style={{ background: `${activeSpeaker.accent}55` }} />
                  <div
                    className="flex h-28 w-28 items-center justify-center rounded-3xl text-3xl font-semibold text-slate-900 ring-4"
                    style={{ background: `linear-gradient(135deg, ${activeSpeaker.accent}, ${activeSpeaker.accent}99)`, boxShadow: `0 0 0 3px ${activeSpeaker.accent}55` }}
                  >
                    {activeSpeaker.name.split(" ").map((w) => w[0]).slice(0, 2).join("")}
                  </div>
                </div>
              ) : (
                <div className="flex h-28 w-28 items-center justify-center rounded-3xl bg-slate-50 text-slate-500">
                  <Sparkles className="h-10 w-10" />
                </div>
              )}
              <div className="text-center">
                <div className="text-base font-semibold text-slate-900">
                  {activeSpeaker?.name ?? (finished ? "Call wrapped up" : "Connecting…")}
                </div>
                <div className="text-xs text-slate-500">
                  {activeSpeaker ? "Speaking…" : finished ? "Ready to save & end" : "AdeHQ workforce call"}
                </div>
              </div>
            </motion.div>
          </AnimatePresence>
        </div>

        {/* Participant tiles */}
        <div className="mt-3 flex flex-wrap gap-2">
          {call.participants.map((p) => (
            <div
              key={p.id}
              className={cn(
                "flex items-center gap-2 rounded-xl border px-2.5 py-1.5 transition-all",
                speaking === p.id ? "border-accent-500/50 bg-accent-500/[0.08]" : "border-slate-200 bg-slate-50",
              )}
            >
              <div
                className={cn("h-7 w-7 shrink-0 rounded-lg", speaking === p.id && "ring-2 ring-accent-400/50")}
                style={{ background: `linear-gradient(135deg, ${p.accent}, ${p.accent}99)` }}
              />
              <span className="text-xs font-medium text-slate-700">{p.name}</span>
              {speaking === p.id && <Mic className="h-3 w-3 text-accent-600" />}
            </div>
          ))}
        </div>

        {/* Controls */}
        <div className="mt-3 flex items-center justify-center gap-2">
          <button
            onClick={() => setMuted((m) => !m)}
            className={cn("flex h-11 w-11 items-center justify-center rounded-xl transition-colors", muted ? "bg-rose-500/20 text-rose-600" : "bg-slate-100 text-slate-700 hover:bg-slate-100")}
          >
            {muted ? <MicOff className="h-5 w-5" /> : <Mic className="h-5 w-5" />}
          </button>
          <button className="flex h-11 w-11 items-center justify-center rounded-xl bg-slate-100 text-slate-700 hover:bg-slate-100">
            <Video className="h-5 w-5" />
          </button>
          <Button variant="danger" onClick={endCall} className="h-11 px-5">
            <PhoneOff className="h-5 w-5" /> End & save
          </Button>
        </div>
      </div>

      {/* Side: transcript + notes */}
      <div className="flex w-full shrink-0 flex-col gap-4 lg:w-80">
        <div className="panel flex min-h-0 flex-1 flex-col p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-900">
            <Mic className="h-4 w-4 text-accent-600" /> Live transcript
          </div>
          <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto pr-1">
            {transcript.map((line) => {
              const p = call.participants.find((pp) => pp.id === line.speakerId);
              return (
                <div key={line.id} className="text-sm">
                  <span className="font-medium" style={{ color: p?.accent ?? "#cbd5e1" }}>
                    {line.speakerName}
                  </span>
                  <span className="ml-1.5 text-[10px] text-slate-600">{formatTime(line.createdAt)}</span>
                  <p className="mt-0.5 text-slate-600">{line.text}</p>
                </div>
              );
            })}
            <div ref={transcriptEndRef} />
          </div>
        </div>

        <div className="panel p-4">
          <div className="mb-2 flex items-center gap-2 text-sm font-medium text-slate-900">
            <ListChecks className="h-4 w-4 text-emerald-700" /> AI action items
          </div>
          {actionItems.length === 0 ? (
            <p className="text-xs text-slate-500">Generating as the call continues…</p>
          ) : (
            <ul className="space-y-1.5">
              <AnimatePresence>
                {actionItems.map((item) => (
                  <motion.li
                    key={item}
                    initial={{ opacity: 0, x: -6 }}
                    animate={{ opacity: 1, x: 0 }}
                    className="flex items-start gap-2 text-xs text-slate-600"
                  >
                    <span className="mt-1 h-1.5 w-1.5 shrink-0 rounded-full bg-emerald-400" />
                    {item}
                  </motion.li>
                ))}
              </AnimatePresence>
            </ul>
          )}
        </div>
      </div>
    </div>
  );
}
