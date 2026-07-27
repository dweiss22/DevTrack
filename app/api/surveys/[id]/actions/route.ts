import { NextResponse } from "next/server";

export async function POST() {
  return NextResponse.json({ error: "Survey is unavailable." }, { status: 404 });
}
