import { NextResponse } from "next/server";
import { buildDemoState } from "@/lib/demo";

export const runtime = "nodejs";

/** Dev-only utility — never available in production deployments. */
export async function POST() {
  if (process.env.NODE_ENV !== "development") {
    return NextResponse.json({ error: "Not found." }, { status: 404 });
  }

  const state = buildDemoState();
  return NextResponse.json({
    ok: true,
    message: "Demo state generated in memory. Use NEXT_PUBLIC_ENABLE_DEMO_MODE=true and loginDemo() locally.",
    workspace: state.workspace.name,
    rooms: state.rooms.length,
    employees: state.employees.length,
  });
}
