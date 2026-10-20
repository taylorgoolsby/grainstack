"use server";

import { revalidatePath } from "next/cache";
import { addNote, deleteNote } from "@/lib/notes";

export async function addNoteAction(formData: FormData) {
  const text = String(formData.get("text") ?? "").trim();
  if (text) await addNote(text);
  revalidatePath("/");
}

export async function deleteNoteAction(formData: FormData) {
  await deleteNote(String(formData.get("sk")));
  revalidatePath("/");
}
