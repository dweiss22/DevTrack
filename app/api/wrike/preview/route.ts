import { NextRequest, NextResponse } from "next/server";
import { z } from "zod";
import { requireAdmin } from "@/lib/auth";
import { wrikeSessionFor } from "@/lib/wrike/oauth";
import { WrikeClient } from "@/lib/wrike/client";
import { taskPath } from "@/lib/wrike/sync";

const schema = z.object({ scopeType: z.enum(["account", "space", "folder", "project", "task", "list"]), sourceIds: z.array(z.string()).min(1) });
export async function POST(request: NextRequest) {
  const { profile } = await requireAdmin(); const parsed = schema.safeParse(await request.json());
  if (!parsed.success) return NextResponse.json({ error: "Choose a scope first." }, { status: 400 });
  const { scopeType, sourceIds } = parsed.data;
  const path = taskPath({ id: "preview", label: "Preview", scope_type: scopeType, source_ids: sourceIds });
  const previewPath = ["account", "space", "folder", "project"].includes(scopeType) ? `${path}&pageSize=20` : path;
  try { const session = await wrikeSessionFor(profile.organization_id); const data = await new WrikeClient(session.accessToken, session.apiBaseUrl).request<{ data: { id: string; title: string; status: string }[] }>(previewPath); return NextResponse.json({ tasks: data.data }); }
  catch (error) { return NextResponse.json({ error: error instanceof Error ? error.message : "Preview failed." }, { status: 502 }); }
}
