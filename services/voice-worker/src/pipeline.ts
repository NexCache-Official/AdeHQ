import type { ControlFrame, VoiceFrame } from "./contracts.js";

export interface FrameProcessor {
  readonly name: string;
  process(frame: VoiceFrame, context: PipelineContext): Promise<VoiceFrame[] | void>;
  close?(reason: "completed" | "cancelled" | "failed"): Promise<void>;
}

export interface PipelineContext {
  readonly signal: AbortSignal;
  emit(frame: VoiceFrame): void;
}

export class FramePipeline {
  readonly #processors: FrameProcessor[];
  readonly #controller = new AbortController();
  readonly #listeners = new Set<(frame: VoiceFrame) => void>();
  #closed = false;

  constructor(processors: FrameProcessor[]) {
    this.#processors = processors;
  }

  get signal(): AbortSignal {
    return this.#controller.signal;
  }

  onFrame(listener: (frame: VoiceFrame) => void): () => void {
    this.#listeners.add(listener);
    return () => this.#listeners.delete(listener);
  }

  async push(frame: VoiceFrame): Promise<void> {
    if (this.#closed) throw new Error("Frame pipeline is closed");
    if (frame.type === "control" && (frame.event === "cancel" || frame.event === "interrupt")) {
      this.#controller.abort(frame.reason ?? frame.event);
    }

    let pending = [frame];
    const context: PipelineContext = {
      signal: this.signal,
      emit: (emitted) => this.#notify(emitted),
    };
    for (const processor of this.#processors) {
      const next: VoiceFrame[] = [];
      for (const current of pending) {
        const output = await processor.process(current, context);
        if (output) next.push(...output);
      }
      pending = next;
      if (pending.length === 0 || this.signal.aborted) break;
    }
    for (const output of pending) this.#notify(output);
  }

  interrupt(frame: Omit<ControlFrame, "type" | "event">): Promise<void> {
    return this.push({ ...frame, type: "control", event: "interrupt" });
  }

  async close(reason: "completed" | "cancelled" | "failed" = "completed"): Promise<void> {
    if (this.#closed) return;
    this.#closed = true;
    if (reason !== "completed" && !this.signal.aborted) this.#controller.abort(reason);
    await Promise.all(this.#processors.map((processor) => processor.close?.(reason)));
    this.#listeners.clear();
  }

  #notify(frame: VoiceFrame): void {
    for (const listener of this.#listeners) listener(frame);
  }
}
