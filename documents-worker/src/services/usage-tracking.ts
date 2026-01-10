import { D1Database } from '@cloudflare/workers-types';
import { getTierLimit, getCurrentBillingPeriod } from '../config/tier-limits';

export interface UsageStats {
  docs_processed: number;
  monthly_limit: number;
  bonus_pool_remaining: number;
  topoff_credits: number;
  billing_period: string;
  percentage_used: number;
}

export class UsageTrackingService {
  constructor(private db: D1Database) {}

  /**
   * Get or create usage record for current billing period
   */
  async getOrCreateUsageRecord(userId: string, userPlan: string): Promise<UsageStats> {
    const billingPeriod = getCurrentBillingPeriod();
    const tierLimit = getTierLimit(userPlan);
    
    // Try to get existing record
    let usage = await this.db.prepare(`
      SELECT * FROM document_usage 
      WHERE user_id = ? AND billing_period_start = ?
    `).bind(userId, billingPeriod).first();
    
    if (!usage) {
      // Create new record for this billing period
      await this.db.prepare(`
        INSERT INTO document_usage (
          user_id, 
          billing_period_start, 
          docs_processed,
          bonus_pool_remaining,
          topoff_credits
        ) VALUES (?, ?, 0, ?, 0)
      `).bind(
        userId, 
        billingPeriod,
        userPlan === 'Free' ? 0 : tierLimit.bonus // No bonus for free tier
      ).run();
      
      usage = {
        user_id: userId,
        billing_period_start: billingPeriod,
        docs_processed: 0,
        bonus_pool_remaining: userPlan === 'Free' ? 0 : tierLimit.bonus,
        topoff_credits: 0
      };
    }
    
    return {
      docs_processed: usage.docs_processed as number,
      monthly_limit: tierLimit.monthly,
      bonus_pool_remaining: usage.bonus_pool_remaining as number,
      topoff_credits: usage.topoff_credits as number,
      billing_period: billingPeriod,
      percentage_used: Math.round((usage.docs_processed as number / tierLimit.monthly) * 100)
    };
  }

  /**
   * Increment document count when a document is processed
   * Note: Currently just tracking - not enforcing limits
   */
  async incrementDocumentCount(
    userId: string, 
    documentId: string,
    docType: string,
    pageCount: number,
    isMultiDoc: boolean = false,
    childCount: number = 0,
    skipExtraction: boolean = false
  ): Promise<void> {
    const billingPeriod = getCurrentBillingPeriod();
    
    // Increment usage counter
    await this.db.prepare(`
      UPDATE document_usage 
      SET docs_processed = docs_processed + 1,
          updated_at = datetime('now', '-6 hours')
      WHERE user_id = ? AND billing_period_start = ?
    `).bind(userId, billingPeriod).run();
    
    // Log individual document processing
    await this.db.prepare(`
      INSERT INTO document_processing_log (
        user_id,
        document_id,
        doc_type,
        page_count,
        was_multi_doc,
        child_count,
        skip_extraction,
        billing_period
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      userId,
      documentId,
      docType,
      pageCount,
      isMultiDoc ? 1 : 0,
      childCount,
      skipExtraction ? 1 : 0,
      billingPeriod
    ).run();
    
    console.log(`[Usage] User ${userId} processed document ${documentId} (${docType}). Billing period: ${billingPeriod}`);
  }

  /**
   * Add top-off credits from one-time purchase
   */
  async addTopOffCredits(userId: string, credits: number): Promise<void> {
    const billingPeriod = getCurrentBillingPeriod();
    
    await this.db.prepare(`
      UPDATE document_usage 
      SET topoff_credits = topoff_credits + ?,
          updated_at = datetime('now', '-6 hours')
      WHERE user_id = ? AND billing_period_start = ?
    `).bind(credits, userId, billingPeriod).run();
    
    console.log(`[Usage] Added ${credits} top-off credits for user ${userId}`);
  }

  /**
   * Get usage statistics for analytics
   */
  async getUsageAnalytics(userId: string, months: number = 6): Promise<any> {
    const sixMonthsAgo = new Date();
    sixMonthsAgo.setMonth(sixMonthsAgo.getMonth() - months);
    
    const analytics = await this.db.prepare(`
      SELECT 
        billing_period,
        COUNT(*) as total_docs,
        SUM(page_count) as total_pages,
        COUNT(CASE WHEN skip_extraction = 1 THEN 1 END) as other_docs,
        COUNT(CASE WHEN was_multi_doc = 1 THEN 1 END) as multi_docs,
        SUM(child_count) as total_children,
        GROUP_CONCAT(DISTINCT doc_type) as doc_types
      FROM document_processing_log
      WHERE user_id = ? AND processed_at >= ?
      GROUP BY billing_period
      ORDER BY billing_period DESC
    `).bind(userId, sixMonthsAgo.toISOString()).all();
    
    return analytics.results;
  }
}