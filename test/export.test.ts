import assert from 'node:assert/strict';
import { describe, it } from 'node:test';

import {
  exportFilename,
  mimeTypeFor,
  noteToMarkdown,
  noteToText,
  serializeNotes,
  type ExportableNote,
} from '../lib/export/format.ts';

const note: ExportableNote = {
  id: 'n1',
  text: 'Ship the ledger migration before Friday.',
  tags: ['work', 'urgent'],
  summary: null,
  createdAt: new Date(2026, 4, 12, 9, 30).getTime(),
};

describe('noteToText', () => {
  it('includes the transcript and tags', () => {
    const output = noteToText(note);
    assert.ok(output.includes('Ship the ledger migration'));
    assert.ok(output.includes('Tags: work, urgent'));
  });

  it('omits the tag line when there are no tags', () => {
    const output = noteToText({ ...note, tags: [] });
    assert.ok(!output.includes('Tags:'));
  });

  it('includes a summary when one exists', () => {
    const output = noteToText({ ...note, summary: 'Ledger work due Friday.' });
    assert.ok(output.includes('Summary: Ledger work due Friday.'));
  });
});

describe('noteToMarkdown', () => {
  it('renders tags as inline code and the summary as a blockquote', () => {
    const output = noteToMarkdown({ ...note, summary: 'Due Friday.' });
    assert.ok(output.includes('`work`'));
    assert.ok(output.includes('`urgent`'));
    assert.ok(output.includes('> Due Friday.'));
    assert.ok(output.startsWith('### '));
  });
});

describe('serializeNotes', () => {
  const notes = [note, { ...note, id: 'n2', text: 'Second note.' }];

  it('round-trips through JSON without loss', () => {
    const parsed = JSON.parse(serializeNotes(notes, 'json'));
    assert.equal(parsed.length, 2);
    assert.equal(parsed[0].text, note.text);
    assert.deepEqual(parsed[0].tags, ['work', 'urgent']);
  });

  it('separates markdown notes with a horizontal rule', () => {
    assert.ok(serializeNotes(notes, 'md').includes('\n---\n'));
  });

  it('separates text notes with a divider', () => {
    assert.ok(serializeNotes(notes, 'txt').includes('----------'));
  });

  it('produces empty-but-valid output for an empty archive', () => {
    assert.equal(serializeNotes([], 'json'), '[]');
    assert.equal(serializeNotes([], 'md'), '');
    assert.equal(serializeNotes([], 'txt'), '');
  });
});

describe('filenames and mime types', () => {
  it('dates a single-note filename by the note, not by today', () => {
    assert.equal(exportFilename('md', note), 'reel-note-2026-05-12.md');
  });

  it('names bulk exports distinctly from single notes', () => {
    assert.ok(exportFilename('json').startsWith('reel-notes-'));
  });

  it('maps every format to a mime type', () => {
    assert.equal(mimeTypeFor('json'), 'application/json');
    assert.equal(mimeTypeFor('md'), 'text/markdown');
    assert.equal(mimeTypeFor('txt'), 'text/plain');
  });
});
