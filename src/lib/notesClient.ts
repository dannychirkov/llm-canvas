export interface NotesSnapshot { notes: string; updatedAt: string; baseUpdatedAt?: string }

export async function readNotes(nodeId: string, canvasId: string, signal?: AbortSignal): Promise<NotesSnapshot> {
  const response = await fetch(`/api/nodes/${encodeURIComponent(nodeId)}/notes?canvasId=${encodeURIComponent(canvasId)}`, { cache: "no-store", signal })
  if (!response.ok) throw new Error("Unable to load notes")
  return response.json()
}

export async function saveNotes(nodeId: string, canvasId: string, notes: string, snapshot: NotesSnapshot, signal?: AbortSignal): Promise<NotesSnapshot> {
  let expected = snapshot
  for (let attempt = 0; attempt < 2; attempt++) {
    const response = await fetch(`/api/nodes/${encodeURIComponent(nodeId)}/notes`, {
      method: "PUT", headers: { "Content-Type": "application/json" }, signal,
      body: JSON.stringify({ notes, canvasId, expectedUpdatedAt: expected.updatedAt })
    })
    if (response.ok) return response.json()
    if (response.status !== 409 || attempt > 0) throw new Error(response.status === 409 ? "Notes changed in another tab. Your draft is preserved; reload to compare changes." : "Unable to save notes. Your draft is preserved.")
    const current = await readNotes(nodeId, canvasId, signal)
    if (current.notes !== snapshot.notes) throw new Error("Notes changed in another tab. Your draft is preserved; reload to compare changes.")
    expected = current
  }
  throw new Error("Unable to save notes")
}
