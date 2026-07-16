import { NextRequest, NextResponse } from "next/server";
import { requireAdmin } from "@/lib/auth";
import { accessTokenFor } from "@/lib/wrike/oauth";
import { WrikeClient } from "@/lib/wrike/client";

type Source = { id: string; title: string; kind: "space" | "folder" | "project" };
export async function GET(request: NextRequest) {
  const { profile } = await requireAdmin(); const term = request.nextUrl.searchParams.get("q")?.trim().toLowerCase();
  try {
    const api = new WrikeClient(await accessTokenFor(profile.organization_id));
    const [spaces, folders] = await Promise.all([
      api.all<{ id: string; title: string }>("/spaces"),
      api.all<{ id: string; title: string; project?: unknown }>("/folders")
    ]);
    const sources: Source[] = [...spaces.map((item) => ({ id: item.id, title: item.title, kind: "space" as const })), ...folders.map((item) => ({ id: item.id, title: item.title, kind: item.project ? "project" as const : "folder" as const }))];
    return NextResponse.json(sources.filter((source) => !term || source.title.toLowerCase().includes(term)).slice(0, 100));
  } catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Unable to retrieve Wrike sources." }, { status: 502 }); }
}
