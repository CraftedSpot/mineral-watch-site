/** Credit pack definitions — display data only, no Stripe price IDs.
 *  The backend resolves packId slugs to Stripe prices server-side. */

export interface CreditPack {
  slug: string;
  name: string;
  credits: number;
  /** Display price in dollars (e.g. 49) */
  price: number;
  /** Per-credit cost string (e.g. "$0.49") */
  perCredit: string;
  badge?: { label: string; bg: string; color: string };
}

export const CREDIT_PACKS: CreditPack[] = [
  { slug: 'starter',    name: 'Starter Pack',    credits: 100,   price: 49,   perCredit: '$0.49' },
  { slug: 'working',    name: 'Working Pack',    credits: 500,   price: 199,  perCredit: '$0.40', badge: { label: 'POPULAR', bg: '#D1FAE5', color: '#047857' } },
  { slug: 'team',       name: 'Team Pack',       credits: 2000,  price: 699,  perCredit: '$0.35' },
  { slug: 'operations', name: 'Operations Pack', credits: 10000, price: 2499, perCredit: '$0.25', badge: { label: 'BEST VALUE', bg: '#DBEAFE', color: '#1D4ED8' } },
];

/** POST to backend checkout endpoint, then redirect to Stripe Checkout.
 *  Throws on network/API errors — caller should catch and show toast. */
export async function purchaseCreditPack(packId: string): Promise<void> {
  // Build return URL pointing to React portal so Stripe redirects back here
  const returnUrl = `${window.location.origin}/portal?tab=documents`;

  const res = await fetch('/api/documents/checkout/credit-pack', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'include',
    body: JSON.stringify({ packId, returnUrl }),
  });

  if (!res.ok) {
    const err = await res.json().catch(() => ({ error: 'Checkout failed' }));
    throw new Error((err as { error?: string }).error || 'Failed to create checkout session');
  }

  const { url } = await res.json() as { url: string };
  window.location.href = url;
}
