import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/AuthForm";
import { Header } from "@/components/Header";
import { hasSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function LoginPage() {
  if (await hasSession()) redirect("/account");
  return (
    <>
      <Header />
      <main className="wrap page">
        <h2>Log in</h2>
        <AuthForm mode="login" />
        <p className="alt">New here? <Link href="/signup">Create an account</Link></p>
      </main>
    </>
  );
}
