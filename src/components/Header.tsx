import Link from "next/link";
import { hasSession } from "@/lib/auth";

export async function Header() {
  const signedIn = await hasSession();
  return (
    <div className="wrap">
      <header className="site-header">
        <Link className="brand" href="/">Grainstack</Link>
        <nav className="site-nav" aria-label="Main">
          {signedIn ? (
            <Link href="/account">Your project</Link>
          ) : (
            <>
              <Link href="/login">Log in</Link>
              <Link href="/signup">Create account</Link>
            </>
          )}
        </nav>
      </header>
    </div>
  );
}
