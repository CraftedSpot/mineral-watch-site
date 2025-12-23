/**
 * Template Exports
 * 
 * Centralized exports for all HTML templates used in the Portal Worker
 */

import dashboardBaseHtml from './dashboard.html';
import loginHtml from './login.html';
import accountHtml from './account.html';
import upgradeHtml from './upgrade.html';
import myPropertiesMapHtml from './my_properties_map.html';
import oklahomaMapHtml from './oklahoma_map.html';
import adminBackfillHtml from './admin-backfill.html';
import learnHtml from './learn.html';

// For testing: Just export the original dashboard for now
const dashboardHtml = dashboardBaseHtml;

export { dashboardHtml, loginHtml, accountHtml, upgradeHtml, myPropertiesMapHtml, oklahomaMapHtml, adminBackfillHtml, learnHtml };