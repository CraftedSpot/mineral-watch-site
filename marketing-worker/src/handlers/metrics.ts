import { Env } from '../types';

const BASE_ID = 'app3j3X29Uvp5stza';
const USERS_TABLE = 'tblmb8sZtfn2EW900'; // 👤 Users

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Content-Type': 'application/json',
};

function jsonResponse(data: any, status = 200): Response {
  return new Response(JSON.stringify(data), { status, headers: CORS_HEADERS });
}

async function stripeGet(env: Env, path: string, params?: Record<string, string>): Promise<any> {
  const url = new URL(`https://api.stripe.com${path}`);
  if (params) {
    for (const [k, v] of Object.entries(params)) {
      url.searchParams.set(k, v);
    }
  }
  const resp = await fetch(url.toString(), {
    headers: { 'Authorization': `Bearer ${env.STRIPE_SECRET_KEY}` },
  });
  return resp.json();
}

export async function handleMetrics(request: Request, env: Env): Promise<Response> {
  try {
    // Run Stripe and Airtable queries in parallel
    const [activeSubs, canceledSubs, userCounts] = await Promise.all([
      stripeGet(env, '/v1/subscriptions', { status: 'active', limit: '100' }),
      stripeGet(env, '/v1/subscriptions', { status: 'canceled', limit: '100' }),
      getAirtableUserCounts(env),
    ]);

    // Calculate MRR from active subs
    let mrr = 0;
    let paidUsers = 0;
    const planBreakdown: Record<string, { count: number; revenue: number }> = {};

    if (activeSubs.data) {
      for (const sub of activeSubs.data) {
        paidUsers++;
        const amount = sub.items?.data?.[0]?.plan?.amount || 0;
        const interval = sub.items?.data?.[0]?.plan?.interval || 'month';
        const monthly = interval === 'year' ? amount / 12 : amount;
        mrr += monthly;

        const planName = sub.items?.data?.[0]?.plan?.nickname || sub.items?.data?.[0]?.price?.nickname || 'Unknown';
        if (!planBreakdown[planName]) {
          planBreakdown[planName] = { count: 0, revenue: 0 };
        }
        planBreakdown[planName].count++;
        planBreakdown[planName].revenue += monthly;
      }
    }

    const mrrDollars = mrr / 100;
    const arrDollars = mrrDollars * 12;

    // Churn: canceled in last 30 days
    const now = Date.now() / 1000;
    const thirtyDaysAgo = now - (30 * 24 * 60 * 60);
    let recentCancels = 0;
    if (canceledSubs.data) {
      for (const sub of canceledSubs.data) {
        if (sub.canceled_at && sub.canceled_at > thirtyDaysAgo) {
          recentCancels++;
        }
      }
    }
    const totalAtStart = paidUsers + recentCancels;
    const churnRate = totalAtStart > 0 ? (recentCancels / totalAtStart * 100) : 0;

    const plans = Object.entries(planBreakdown).map(([name, data]) => ({
      name,
      count: data.count,
      revenue: data.revenue / 100,
    }));

    const freeUsers = Math.max(0, userCounts.totalUsers - paidUsers);
    const conversionPct = userCounts.totalUsers > 0
      ? Math.round((paidUsers / userCounts.totalUsers) * 1000) / 10
      : 0;

    const planSummary = plans.map(p => `${p.name}: ${p.count}`).join(', ');

    return jsonResponse({
      funnel: {
        signups: userCounts.totalUsers,
        activated: userCounts.activatedUsers,
        paid: paidUsers,
        conversion: conversionPct,
        mrr: mrrDollars,
        mrrDetail: planSummary || 'No active plans',
      },
      metrics: {
        totalSignups: userCounts.totalUsers,
        freeUsers,
        paidUsers,
        churn: Math.round(churnRate * 10) / 10,
        mrr: mrrDollars,
        arr: arrDollars,
      },
      plans,
      usersByPlan: userCounts.byPlan,
      accountsByPlan: userCounts.accountsByPlan,
    });
  } catch (error: any) {
    console.error('Metrics error:', error);
    return jsonResponse({ error: error.message }, 500);
  }
}

interface UserCounts {
  totalUsers: number;
  activatedUsers: number;
  byPlan: Record<string, number>;
  accountsByPlan: Record<string, number>;
}

async function getAirtableUserCounts(env: Env): Promise<UserCounts> {
  let totalUsers = 0;
  let activatedUsers = 0;
  const byPlan: Record<string, number> = {};
  // Track unique accounts per plan: org users share one account, solo users = 1 account each
  const seenOrgs: Record<string, Set<string>> = {};
  let soloCountByPlan: Record<string, number> = {};
  let offset: string | undefined;

  try {
    // Paginate through all users (Airtable returns max 100 per page)
    do {
      let url = `https://api.airtable.com/v0/${BASE_ID}/${USERS_TABLE}?pageSize=100&fields%5B%5D=Plan&fields%5B%5D=Status&fields%5B%5D=${encodeURIComponent('📍 Client Properties')}&fields%5B%5D=${encodeURIComponent('Organization ID')}`;
      if (offset) {
        url += `&offset=${offset}`;
      }

      const resp = await fetch(url, {
        headers: { 'Authorization': `Bearer ${env.MINERAL_AIRTABLE_API_KEY}` },
      });
      const data = await resp.json() as any;

      if (data.records) {
        for (const record of data.records) {
          const status = record.fields?.Status;
          if (status === 'Disabled' || status === 'Banned') continue;

          totalUsers++;

          const plan = record.fields?.Plan || 'Free';
          byPlan[plan] = (byPlan[plan] || 0) + 1;

          // Track accounts: group by org, or count as solo
          const orgId = record.fields?.['Organization ID'];
          if (orgId) {
            if (!seenOrgs[plan]) seenOrgs[plan] = new Set();
            seenOrgs[plan].add(orgId);
          } else {
            soloCountByPlan[plan] = (soloCountByPlan[plan] || 0) + 1;
          }

          // Activated = has at least 1 linked property
          const properties = record.fields?.['📍 Client Properties'];
          if (properties && Array.isArray(properties) && properties.length > 0) {
            activatedUsers++;
          }
        }
      }

      offset = data.offset;
    } while (offset);

    // Calculate accounts per plan: unique orgs + solo users
    const accountsByPlan: Record<string, number> = {};
    const allPlans = new Set([...Object.keys(byPlan), ...Object.keys(seenOrgs), ...Object.keys(soloCountByPlan)]);
    for (const plan of allPlans) {
      const orgCount = seenOrgs[plan]?.size || 0;
      const soloCount = soloCountByPlan[plan] || 0;
      accountsByPlan[plan] = orgCount + soloCount;
    }

    return { totalUsers, activatedUsers, byPlan, accountsByPlan };
  } catch (error) {
    console.error('Airtable user count error:', error);
    return { totalUsers: 0, activatedUsers: 0, byPlan: {}, accountsByPlan: {} };
  }
}
