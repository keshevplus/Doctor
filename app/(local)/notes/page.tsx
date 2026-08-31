import type { Metadata } from 'next';

import { NotesView } from '@/components/NotesView';

export const metadata: Metadata = { title: 'Notes' };

export default function NotesPage() {
  return <NotesView />;
}
