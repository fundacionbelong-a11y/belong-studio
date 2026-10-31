import { NextRequest, NextResponse } from "next/server";
import { createSession, setSessionCookie } from "@/lib/auth";

export async function POST(req: NextRequest) {
  try {
    const { password } = await req.json();
    const expected = process.env.STUDIO_PASSWORD;
    if (!expected) {
      return NextResponse.json(
        { error: "El servidor no está configurado. Contacta al administrador." },
        { status: 500 }
      );
    }
    if (!password || password !== expected) {
      return NextResponse.json(
        { error: "Contraseña incorrecta. Inténtalo de nuevo." },
        { status: 401 }
      );
    }
    const token = await createSession();
    await setSessionCookie(token);
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json(
      { error: "Ocurrió un error inesperado. Inténtalo de nuevo." },
      { status: 500 }
    );
  }
}
