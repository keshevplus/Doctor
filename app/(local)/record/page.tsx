import type { Metadata } from 'next';

import { RecordScreen } from './RecordScreen';

export const metadata: Metadata = { title: 'Record' };

export default function RecordPage() {
  return <RecordScreen />;
}
