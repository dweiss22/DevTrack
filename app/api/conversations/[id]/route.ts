import { NextRequest, NextResponse } from "next/server";
import { requireContext } from "@/lib/auth";

export async function GET(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; const { user, supabase } = await requireContext();
  const { data: conversation } = await supabase.from("reporting_conversations").select("id,title,created_at,updated_at").eq("id", id).eq("user_id", user.id).maybeSingle();
  if (!conversation) return NextResponse.json({ error: "Conversation not found." }, { status: 404 });
  const { data: messages } = await supabase.from("reporting_messages").select("id,role,content,result_references,created_at").eq("conversation_id", id).order("created_at");
  return NextResponse.json({ conversation, messages: messages ?? [] });
}

export async function DELETE(_request: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params; const { user, supabase } = await requireContext();
  const { error } = await supabase.from("reporting_conversations").delete().eq("id", id).eq("user_id", user.id);
  if (error) return NextResponse.json({ error: "Unable to delete the conversation." }, { status: 500 });
  return NextResponse.json({ ok: true });
}
