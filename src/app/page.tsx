import Link from "next/link";
import { redirect } from "next/navigation";
import { Header } from "@/components/Header";
import { Silo } from "@/components/Silo";
import { hasSession } from "@/lib/auth";

export default async function Home() {
  if (await hasSession()) redirect("/account");
  return (
    <>
      <Header />
      <main className="wrap hero">
        <div>
          <h1>Your Next.js app, already wired to your own AWS.</h1>
          <p className="lede">
            Create an account and we build your dev and prod databases, access keys and Lambda functions.
            You download a project that runs with <code>npm run dev</code> and deploys with one command.
          </p>
          <div className="actions">
            <Link className="btn primary" href="/signup">Create account</Link>
            <Link className="btn" href="/login">Log in</Link>
          </div>
          <ul className="facts">
            <li>Two DynamoDB tables, one for dev and one for prod</li>
            <li>Two Lambda web functions, each with its own HTTPS address</li>
            <li>Local keys that can only reach the dev table</li>
          </ul>
        </div>
        <Silo ratio={0.62} />
      </main>
    </>
  );
}
