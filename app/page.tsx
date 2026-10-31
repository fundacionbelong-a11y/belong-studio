import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";
import Wizard from "@/components/Wizard";

export const dynamic = "force-dynamic";

export default async function Home() {
  if (!(await isAuthenticated())) redirect("/login");
  return (
    <main className="min-h-screen px-4 py-8">
      <div className="max-w-3xl mx-auto">
        <header className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-3xl font-semibold">Belong Studio</h1>
            <p className="text-stone-500 text-sm mt-1">
              Hola Pamela, aquí puedes publicar tus artículos directamente.
            </p>
          </div>
          <form
            action="/api/logout"
            method="post"
            onSubmit={async (e) => {
              "use server";
            }}
          >
            <LogoutButton />
          </form>
        </header>
        <Wizard />
      </div>
    </main>
  );
}

function LogoutButton() {
  return (
    <button
      formAction={async () => {
        "use server";
        const { cookies } = await import("next/headers");
        const store = await cookies();
        store.set("belong_session", "", { path: "/", maxAge: 0 });
      }}
      className="text-sm text-stone-500 hover:text-stone-800 underline"
    >
      Cerrar sesión
    </button>
  );
}
