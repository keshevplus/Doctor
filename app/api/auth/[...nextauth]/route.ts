import { handlers } from '@/lib/auth';

// The passkey provider needs Node crypto; this route cannot run on the edge.
export const runtime = 'nodejs';

export const { GET, POST } = handlers;
