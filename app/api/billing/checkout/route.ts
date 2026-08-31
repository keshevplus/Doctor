import { z } from 'zod';

import { requireApiUser } from '@/lib/auth/guards';
import { createCheckoutSession } from '@/lib/billing/stripe';
import { LIMITS, rateLimit } from '@/lib/security/rate-limit';
import { errorResponse, isSameOrigin, rateLimitResponse } from '@/lib/security/request';
import { CREDIT_PACKS } from '@/lib/credits/pricing';

export const runtime = 'nodejs';

// Only a pack id crosses the wire. Prices are resolved server-side from the
// catalog, so there is nothing here worth tampering with.
const bodySchema = z.object({
  packId: z.enum(CREDIT_PACKS.map((p) => p.id) as [string, ...string[]]),
});

export async function POST(request: Request): Promise<Response> {
  if (!isSameOrigin(request)) {
    return errorResponse('forbidden_origin', 'Cross-origin request rejected', 403);
  }

  const user = await requireApiUser();
  if (!user) return errorResponse('unauthorized', 'Sign in to buy credits', 401);

  const limit = await rateLimit({ scope: 'checkout', subject: user.id, ...LIMITS.checkout });
  if (!limit.ok) return rateLimitResponse(limit.resetAt);

  const parsed = bodySchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return errorResponse('invalid_body', 'Unknown credit pack', 400);
  }

  try {
    const { url } = await createCheckoutSession({
      userId: user.id,
      email: user.email,
      packId: parsed.data.packId,
    });
    return Response.json({ url });
  } catch (error) {
    console.error('checkout creation failed', { userId: user.id, error });
    return errorResponse('checkout_failed', 'Could not start checkout. Try again.', 502);
  }
}
