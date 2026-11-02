"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

export default function LoginPage() {
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ password }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "No se pudo iniciar sesión.");
        return;
      }
      router.push("/");
      router.refresh();
    } catch {
      setError("No se pudo conectar. Inténtalo de nuevo.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="min-h-screen flex items-center justify-center px-4">
      <div className="w-full max-w-sm bg-white rounded-[1.25rem] shadow-lift border border-pearl-200 p-8">
        <h1 className="font-display text-3xl text-ink-900 text-center mb-1">Belong Studio</h1>
        <p className="text-sm text-ink-500 text-center mb-8">
          Publica tus artículos en fundacionbelong.org
        </p>
        <form onSubmit={submit} className="space-y-5">
          <div>
            <label htmlFor="password" className="block text-sm font-medium text-ink-700 mb-1.5">
              Contraseña
            </label>
            <input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full rounded-xl border border-pearl-200 bg-cream-50 px-4 py-3 focus:outline-none focus:ring-2 focus:ring-olive-400 focus:border-olive-300 text-ink-900"
              autoFocus
            />
          </div>
          {error && (
            <p className="text-sm text-terra-600 bg-terra-300/10 border border-terra-300/30 rounded-xl px-4 py-2.5">{error}</p>
          )}
          <button
            type="submit"
            disabled={loading}
            className="w-full bg-olive-600 hover:bg-olive-700 text-white rounded-xl py-3 font-medium shadow-soft hover:shadow-lift hover:-translate-y-0.5 disabled:opacity-50 disabled:hover:translate-y-0"
          >
            {loading ? "Entrando…" : "Entrar"}
          </button>
        </form>
      </div>
    </main>
  );
}
