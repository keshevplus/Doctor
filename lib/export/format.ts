export interface ExportableNote {
  id: string;
  text: string;
  tags: string[];
  summary?: string | null;
  createdAt: number;
}

export type ExportFormat = 'txt' | 'md' | 'json';

export function formatTimestamp(ts: number): string {
  const date = new Date(ts);
  return `${date.toLocaleDateString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  })} · ${date.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' })}`;
}

export function noteToText(note: ExportableNote): string {
  const lines = [formatTimestamp(note.createdAt)];
  if (note.tags.length) lines.push(`Tags: ${note.tags.join(', ')}`);
  if (note.summary) lines.push('', `Summary: ${note.summary}`);
  lines.push('', note.text, '');
  return lines.join('\n');
}

export function noteToMarkdown(note: ExportableNote): string {
  const lines = [`### ${formatTimestamp(note.createdAt)}`, ''];
  if (note.tags.length) {
    lines.push(`Tags: ${note.tags.map((tag) => `\`${tag}\``).join(' ')}`, '');
  }
  if (note.summary) lines.push(`> ${note.summary}`, '');
  lines.push(note.text, '');
  return lines.join('\n');
}

export function serializeNotes(notes: readonly ExportableNote[], format: ExportFormat): string {
  switch (format) {
    case 'json':
      return JSON.stringify(notes, null, 2);
    case 'md':
      return notes.map(noteToMarkdown).join('\n---\n\n');
    case 'txt':
      return notes.map(noteToText).join('\n----------\n\n');
  }
}

export function mimeTypeFor(format: ExportFormat): string {
  switch (format) {
    case 'json':
      return 'application/json';
    case 'md':
      return 'text/markdown';
    case 'txt':
      return 'text/plain';
  }
}

export function exportFilename(format: ExportFormat, single?: ExportableNote): string {
  const stamp = new Date(single?.createdAt ?? Date.now()).toISOString().slice(0, 10);
  return single ? `reel-note-${stamp}.${format}` : `reel-notes-${stamp}.${format}`;
}

/**
 * Trigger a download in the browser.
 *
 * Kept separate from the serializers above so those stay pure and testable —
 * this is the only part that touches the DOM.
 */
export function downloadNotes(
  notes: readonly ExportableNote[],
  format: ExportFormat,
  single?: ExportableNote,
): void {
  const content = serializeNotes(notes, format);
  const blob = new Blob([content], { type: mimeTypeFor(format) });
  const url = URL.createObjectURL(blob);

  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = exportFilename(format, single);
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();

  // Revoking immediately can cancel the download in some browsers.
  setTimeout(() => URL.revokeObjectURL(url), 1_000);
}
