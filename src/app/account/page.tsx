import { redirect } from "next/navigation";
import { AccountPanel } from "@/components/AccountPanel";
import { Header } from "@/components/Header";
import { currentStatus } from "@/lib/account";

export const dynamic = "force-dynamic";

export default async function AccountPage() {
  const status = await currentStatus();
  if (!status) redirect("/login");
  return (
    <>
      <Header />
      <AccountPanel initial={status} />
    </>
  );
}
