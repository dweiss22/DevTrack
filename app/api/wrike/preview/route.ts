import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { accessTokenFor } from "@/lib/wrike/oauth";
import { WrikeClient } from "@/lib/wrike/client";

const schema = z.object({ scopeType: z.enum(["account", "space", "folder", "project", "task", "list"]), sourceIds: z.array(z.string()).min(1) });
export async function POST(request: NextRequest) {
  const { profile } = await requireAdmin(); const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Choose a scope first." }, { status: 400 });
  const { scopeType, sourceIds } = parsed.data; const id = encodeURIComponent(sourceIds[0]);
  const path = scopeType === "account" ? "/tasks" : scopeType === "space" ? `/spaces/${id}/tasks` : scopeType === "folder" || scopeType === "project" ? `/folders/${id}/tasks` : scopeType === "task" ? `/tasks/${id}/tasks` : `/tasks?ids=${sourceIds.map(encodeURIComponent).join(",")}`;
  try { const data = await new WrikeClient(await accessTokenFor(profile.organization_id)).request<{ data: { id: string; title: string; status: string }[] }>(`${path}${path.includes("?") ? "&" : "?"}pageSize=20`); return NextResponse.json({ tasks: data.data }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Preview failed." }, { status: 502 }); }
}
