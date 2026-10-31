import { NextResponse } from "next/server";
import { cookies } from "next/headers";

export async function POST() {
  const store = await cookies();
  store.set("belong_session", "", { path: "/", maxAge: 0 });
  return NextResponse.json({ ok: true });
}
