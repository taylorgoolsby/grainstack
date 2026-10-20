import { listNotes } from "@/lib/notes";
import { addNoteAction, deleteNoteAction } from "./actions";

export const dynamic = "force-dynamic"; // always render at request time

export default async function Home() {
  const notes = await listNotes();

  return (
    <main style={{ maxWidth: 600, margin: "40px auto", fontFamily: "sans-serif" }}>
      <h1>Notes ({process.env.APP_ENV ?? "local"})</h1>

      <form action={addNoteAction} style={{ display: "flex", gap: 8 }}>
        <input name="text" required placeholder="New note" style={{ flex: 1 }} />
        <button type="submit">Add</button>
      </form>

      <ul>
        {notes.map((n) => (
          <li key={n.sk} style={{ marginTop: 8 }}>
            {n.text}{" "}
            <form action={deleteNoteAction} style={{ display: "inline" }}>
              <input type="hidden" name="sk" value={n.sk} />
              <button type="submit">Delete</button>
            </form>
          </li>
        ))}
      </ul>
    </main>
  );
}
