import Link from "next/link";
import { redirect } from "next/navigation";
import { AuthForm } from "@/components/AuthForm";
import { Header } from "@/components/Header";
import { hasSession } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function SignupPage() {
  if (await hasSession()) redirect("/account");
  return (
    <>
      <Header />
      <main className="wrap page">
        <h2>Create your account</h2>
        <p className="muted" style={{ marginTop: 8, maxWidth: "52ch" }}>
          We start building your AWS resources as soon as you submit this form.
        </p>
        <AuthForm mode="signup" requireInvite={!!process.env.SIGNUP_INVITE_CODE} />
        <p className="alt">Already have an account? <Link href="/login">Log in</Link></p>
      </main>
    </>
  );
}
