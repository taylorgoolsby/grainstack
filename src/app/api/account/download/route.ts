import { getSessionUser } from "@/lib/auth";
import { envFiles } from "@/lib/provisioner";
import { buildBoilerplateZip } from "@/lib/zip";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const user = await getSessionUser();
  if (!user) return Response.json({ error: "Not signed in." }, { status: 401 });
  if (user.status !== "ready") return Response.json({ error: "Your project isn't ready yet." }, { status: 409 });

  // Secrets are read fresh for every download and never stored by the portal.
  const files = await envFiles(user.username);
  const zip = buildBoilerplateZip(user.username, files);

  return new Response(Buffer.from(zip), {
    headers: {
      "Content-Type": "application/zip",
      "Content-Disposition": `attachment; filename="grainstack-${user.username}.zip"`,
      "Cache-Control": "no-store",
    },
  });
}
