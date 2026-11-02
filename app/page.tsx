import { redirect } from "next/navigation";
import { isAuthenticated } from "@/lib/auth";
import Wizard from "@/components/Wizard";

export const dynamic = "force-dynamic";

export default async function Home() {
  if (!(await isAuthenticated())) redirect("/login");
  return (
    <main className="min-h-screen relative">
      <div className="absolute top-5 right-5">
        <LogoutButton />
      </div>
      <Wizard />
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
      className="text-xs text-ink-300 hover:text-ink-700 underline underline-offset-2"
    >
      Cerrar sesión
    </button>
  );
}
