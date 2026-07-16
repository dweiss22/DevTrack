import { NextResponse } from "next/server";
import { requireContext } from "@/lib/auth";

export async function GET() {
  const { user, supabase } = await requireContext();
  const { data, error } = await supabase.from("reporting_conversations").select("id,title,created_at,updated_at").eq("user_id", user.id).order("updated_at", { ascending: false });
  if (error) return NextResponse.json({ error: "Unable to load conversations." }, { status: 500 });
  return NextResponse.json({ conversations: data ?? [] });
}
