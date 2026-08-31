/** A note as it exists on the client. */
export interface LocalNote {
  id: string;
  text: string;
  tags: string[];
  /** Object URL is derived at render time; the blob itself lives in IndexedDB. */
  audio: Blob | null;
  audioDurationSec: number | null;
  summary: string | null;
  createdAt: number;
  updatedAt: number;
  deletedAt: number | null;
  version: number;
  /**
   * Sync state. 'local' means this device has changes the server has not seen.
   * Notes never leave the device while the user is signed out, so 'local' is
   * the resting state for the whole free tier.
   */
  syncState: 'local' | 'synced' | 'pending';
}

export function makeId(): string {
  if (typeof crypto !== 'undefined' && 'randomUUID' in crypto) return crypto.randomUUID();
  return `n${Date.now()}${Math.random().toString(16).slice(2)}`;
}

export function parseTags(raw: string): string[] {
  return [
    ...new Set(
      raw
        .split(',')
        .map((t) => t.trim().toLowerCase())
        .filter(Boolean),
    ),
  ];
}
