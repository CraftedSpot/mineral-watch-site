export interface PlanConfig {
  properties: number;
  wells: number;
  members: number;
  features: string[];
}

export const PLAN_CONFIGS: Record<string, PlanConfig> = {
  'Free': {
    properties: 1, wells: 1, members: 1,
    features: ['1 property', '1 well', '3 document credits/month', 'Adjacent monitoring', 'Daily scans', 'Email alerts'],
  },
  'Starter': {
    properties: 10, wells: 10, members: 1,
    features: ['10 properties', '10 wells', '10 document credits/month', 'Adjacent monitoring', 'Daily scans', 'Email alerts', 'Email support'],
  },
  'Standard': {
    properties: 50, wells: 50, members: 1,
    features: ['50 properties', '50 wells', '25 document credits/month', 'Adjacent monitoring', 'Daily scans', 'Priority support', 'Export data', 'Free copy of The Mineral Rights Guide'],
  },
  'Professional': {
    properties: 250, wells: 250, members: 1,
    features: ['250 properties', '250 wells', '50 document credits/month', 'Adjacent monitoring', 'Daily scans', 'Priority support', 'Bulk upload', 'Export data', 'Organization management', 'Free copy of The Mineral Rights Guide'],
  },
  'Business': {
    properties: 500, wells: 500, members: 3,
    features: ['500 properties', '500 wells', '100 document credits/month', '3 team members', 'Adjacent monitoring', 'Daily scans', 'Priority support', 'Dedicated support', 'Export data', 'Free copy of The Mineral Rights Guide'],
  },
  'Enterprise 1K': {
    properties: 1000, wells: 1000, members: 5,
    features: ['1,000 properties', '1,000 wells', '150 document credits/month', '5+ team members', 'All features', 'Dedicated support', 'Export data', 'Free copy of The Mineral Rights Guide'],
  },
};

export function getPlanConfig(plan: string): PlanConfig {
  return PLAN_CONFIGS[plan] || PLAN_CONFIGS['Free'];
}

/** Plans that have organization/team features */
export function hasOrgFeatures(plan: string): boolean {
  return plan === 'Business' || plan.startsWith('Enterprise');
}
