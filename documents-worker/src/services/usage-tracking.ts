import { D1Database } from '@cloudflare/workers-types';
import { getTierLimit, getCurrentBillingPeriod, TierLimit } from '../config/tier-limits';

export interface UsageStats {
  docs_processed: number;
  credits_used: number;
  monthly_limit: number;
  monthly_remaining: number;
  purchased_credits: number;
  permanent_credits: number;  // bonus credits
  billing_period: string;
  percentage_used: number;
  total_available: number;
  reset_date: string;
  is_lifetime_tier: boolean;
}

export interface CreditCheckResult {
  hasCredits: boolean;
  monthlyRemaining: number;
  purchasedRemaining: number;
  permanentRemaining: number;  // bonus credits
  totalAvailable: number;
  message?: string;
}

export class UsageTrackingService {
  constructor(private db: D1Database) {}

  /**
   * Check if user has credits available for document processing
   * Returns detailed credit availability info
   */
  async checkCreditsAvailable(userId: string, userPlan: string): Promise<CreditCheckResult> {
    const tierLimit = getTierLimit(userPlan);
    const isLifetimeTier = tierLimit.isLifetime === true;

    // Get credit balance (includes purchased and bonus)
    const creditBalance = await this.getOrCreateCreditBalance(userId, userPlan);

    if (isLifetimeTier) {
      // Free tier: check lifetime credits (10 total, never resets)
      const lifetimeRemaining = creditBalance.lifetime_credits_granted - creditBalance.lifetime_credits_used;
      return {
        hasCredits: lifetimeRemaining > 0,
        monthlyRemaining: 0,
        purchasedRemaining: creditBalance.purchased_credits,
        permanentRemaining: lifetimeRemaining,
        totalAvailable: lifetimeRemaining + creditBalance.purchased_credits,
        message: lifetimeRemaining <= 0 && creditBalance.purchased_credits <= 0 ? 'You have used all your free trial credits. Upgrade to continue processing documents.' : undefined
      };
    }

    // Paid tier: check monthly + purchased + bonus
    const billingPeriod = getCurrentBillingPeriod();
    const usage = await this.getOrCreateUsageRecord(userId, userPlan);

    const monthlyRemaining = Math.max(0, tierLimit.monthly - usage.monthly_credits_used);
    const purchasedRemaining = creditBalance.purchased_credits;
    const permanentRemaining = creditBalance.permanent_credits;  // bonus credits
    const totalAvailable = monthlyRemaining + purchasedRemaining + permanentRemaining;

    return {
      hasCredits: totalAvailable > 0,
      monthlyRemaining,
      purchasedRemaining,
      permanentRemaining,
      totalAvailable,
      message: totalAvailable <= 0 ? 'You have no credits remaining this month. Purchase a credit pack or wait for your monthly reset.' : undefined
    };
  }

  /**
   * Get or create the permanent credit balance record for a user
   */
  async getOrCreateCreditBalance(userId: string, userPlan: string): Promise<{
    purchased_credits: number;
    permanent_credits: number;  // bonus credits
    lifetime_credits_granted: number;
    lifetime_credits_used: number;
  }> {
    let balance = await this.db.prepare(`
      SELECT purchased_credits, permanent_credits, lifetime_credits_granted, lifetime_credits_used
      FROM user_credit_balance
      WHERE user_id = ?
    `).bind(userId).first();

    if (!balance) {
      const tierLimit = getTierLimit(userPlan);
      const isLifetimeTier = tierLimit.isLifetime === true;

      // Initialize credits based on tier
      const lifetimeCredits = isLifetimeTier ? tierLimit.bonus : 0;  // Free tier gets 10 lifetime
      const permanentCredits = isLifetimeTier ? 0 : 0;  // Paid tiers get bonus on annual signup (handled by webhook)

      await this.db.prepare(`
        INSERT INTO user_credit_balance (
          user_id,
          purchased_credits,
          permanent_credits,
          lifetime_credits_granted,
          lifetime_credits_used
        ) VALUES (?, 0, ?, ?, 0)
      `).bind(userId, permanentCredits, lifetimeCredits).run();

      console.log(`[Credits] Initialized credit balance for user ${userId}: lifetime=${lifetimeCredits}, permanent=${permanentCredits}`);

      balance = {
        purchased_credits: 0,
        permanent_credits: permanentCredits,
        lifetime_credits_granted: lifetimeCredits,
        lifetime_credits_used: 0
      };
    }

    return {
      purchased_credits: (balance.purchased_credits as number) || 0,
      permanent_credits: balance.permanent_credits as number,
      lifetime_credits_granted: balance.lifetime_credits_granted as number,
      lifetime_credits_used: balance.lifetime_credits_used as number
    };
  }

  /**
   * Get or create usage record for current billing period
   */
  async getOrCreateUsageRecord(userId: string, userPlan: string): Promise<{
    docs_processed: number;
    monthly_credits_used: number;
    billing_period: string;
  }> {
    const billingPeriod = getCurrentBillingPeriod();

    let usage = await this.db.prepare(`
      SELECT docs_processed, monthly_credits_used
      FROM document_usage
      WHERE user_id = ? AND billing_period_start = ?
    `).bind(userId, billingPeriod).first();

    if (!usage) {
      // Create new record for this billing period
      await this.db.prepare(`
        INSERT INTO document_usage (
          user_id,
          billing_period_start,
          docs_processed,
          monthly_credits_used,
          credits_used
        ) VALUES (?, ?, 0, 0, 0)
      `).bind(userId, billingPeriod).run();

      usage = {
        docs_processed: 0,
        monthly_credits_used: 0
      };
    }

    return {
      docs_processed: usage.docs_processed as number,
      monthly_credits_used: (usage.monthly_credits_used as number) || 0,
      billing_period: billingPeriod
    };
  }

  /**
   * Get full usage statistics for display
   */
  async getUsageStats(userId: string, userPlan: string): Promise<UsageStats> {
    const tierLimit = getTierLimit(userPlan);
    const isLifetimeTier = tierLimit.isLifetime === true;
    const billingPeriod = getCurrentBillingPeriod();

    const usage = await this.getOrCreateUsageRecord(userId, userPlan);
    const creditBalance = await this.getOrCreateCreditBalance(userId, userPlan);

    let monthlyRemaining: number;
    let purchasedCredits: number;
    let permanentCredits: number;  // bonus credits
    let totalAvailable: number;

    if (isLifetimeTier) {
      // Free tier: lifetime credits only (plus any purchased)
      monthlyRemaining = 0;
      purchasedCredits = creditBalance.purchased_credits;
      permanentCredits = creditBalance.lifetime_credits_granted - creditBalance.lifetime_credits_used;
      totalAvailable = permanentCredits + purchasedCredits;
    } else {
      // Paid tier: monthly + purchased + bonus
      monthlyRemaining = Math.max(0, tierLimit.monthly - usage.monthly_credits_used);
      purchasedCredits = creditBalance.purchased_credits;
      permanentCredits = creditBalance.permanent_credits;  // bonus credits
      totalAvailable = monthlyRemaining + purchasedCredits + permanentCredits;
    }

    // Calculate reset date (first day of next month)
    const resetDate = new Date(billingPeriod);
    resetDate.setMonth(resetDate.getMonth() + 1);

    return {
      docs_processed: usage.docs_processed,
      credits_used: usage.monthly_credits_used,
      monthly_limit: tierLimit.monthly,
      monthly_remaining: monthlyRemaining,
      purchased_credits: purchasedCredits,
      permanent_credits: permanentCredits,
      billing_period: billingPeriod,
      percentage_used: tierLimit.monthly > 0 ? Math.round((usage.monthly_credits_used / tierLimit.monthly) * 100) : 0,
      total_available: totalAvailable,
      reset_date: resetDate.toISOString().split('T')[0],
      is_lifetime_tier: isLifetimeTier
    };
  }

  /**
   * Deduct a credit for document processing
   * Deduction order: Monthly first, then Purchased, then Bonus (permanent)
   *
   * Returns true if credit was successfully deducted, false if no credits available
   */
  async deductCredit(userId: string, userPlan: string): Promise<boolean> {
    const tierLimit = getTierLimit(userPlan);
    const isLifetimeTier = tierLimit.isLifetime === true;
    const billingPeriod = getCurrentBillingPeriod();

    if (isLifetimeTier) {
      // Free tier: try lifetime credits first, then purchased
      const creditBalance = await this.getOrCreateCreditBalance(userId, userPlan);
      const lifetimeRemaining = creditBalance.lifetime_credits_granted - creditBalance.lifetime_credits_used;

      if (lifetimeRemaining > 0) {
        const result = await this.db.prepare(`
          UPDATE user_credit_balance
          SET lifetime_credits_used = lifetime_credits_used + 1,
              updated_at = datetime('now', '-6 hours')
          WHERE user_id = ?
            AND lifetime_credits_used < lifetime_credits_granted
        `).bind(userId).run();

        if (result.meta.changes > 0) {
          console.log(`[Credits] Deducted 1 lifetime credit for user ${userId}`);
          return true;
        }
      }

      // Try purchased credits for free tier
      if (creditBalance.purchased_credits > 0) {
        const result = await this.db.prepare(`
          UPDATE user_credit_balance
          SET purchased_credits = purchased_credits - 1,
              updated_at = datetime('now', '-6 hours')
          WHERE user_id = ? AND purchased_credits > 0
        `).bind(userId).run();

        if (result.meta.changes > 0) {
          console.log(`[Credits] Deducted 1 purchased credit for free tier user ${userId}. Remaining: ${creditBalance.purchased_credits - 1}`);
          return true;
        }
      }

      console.log(`[Credits] User ${userId} has no lifetime or purchased credits remaining`);
      return false;
    }

    // Paid tier: try monthly first, then purchased, then bonus (permanent)
    const usage = await this.getOrCreateUsageRecord(userId, userPlan);
    const creditBalance = await this.getOrCreateCreditBalance(userId, userPlan);

    const monthlyRemaining = Math.max(0, tierLimit.monthly - usage.monthly_credits_used);

    // 1. Try monthly credits first
    if (monthlyRemaining > 0) {
      await this.db.prepare(`
        UPDATE document_usage
        SET monthly_credits_used = monthly_credits_used + 1,
            credits_used = credits_used + 1,
            updated_at = datetime('now', '-6 hours')
        WHERE user_id = ? AND billing_period_start = ?
      `).bind(userId, billingPeriod).run();

      console.log(`[Credits] Deducted 1 monthly credit for user ${userId}. Remaining: ${monthlyRemaining - 1}`);
      return true;
    }

    // 2. Try purchased credits second
    if (creditBalance.purchased_credits > 0) {
      const result = await this.db.prepare(`
        UPDATE user_credit_balance
        SET purchased_credits = purchased_credits - 1,
            updated_at = datetime('now', '-6 hours')
        WHERE user_id = ? AND purchased_credits > 0
      `).bind(userId).run();

      if (result.meta.changes > 0) {
        // Also track in document_usage for analytics
        await this.db.prepare(`
          UPDATE document_usage
          SET credits_used = credits_used + 1,
              updated_at = datetime('now', '-6 hours')
          WHERE user_id = ? AND billing_period_start = ?
        `).bind(userId, billingPeriod).run();

        console.log(`[Credits] Deducted 1 purchased credit for user ${userId}. Remaining: ${creditBalance.purchased_credits - 1}`);
        return true;
      }
    }

    // 3. Try bonus (permanent) credits last
    if (creditBalance.permanent_credits > 0) {
      const result = await this.db.prepare(`
        UPDATE user_credit_balance
        SET permanent_credits = permanent_credits - 1,
            updated_at = datetime('now', '-6 hours')
        WHERE user_id = ? AND permanent_credits > 0
      `).bind(userId).run();

      if (result.meta.changes > 0) {
        // Also track in document_usage for analytics
        await this.db.prepare(`
          UPDATE document_usage
          SET credits_used = credits_used + 1,
              updated_at = datetime('now', '-6 hours')
          WHERE user_id = ? AND billing_period_start = ?
        `).bind(userId, billingPeriod).run();

        console.log(`[Credits] Deducted 1 bonus credit for user ${userId}. Remaining: ${creditBalance.permanent_credits - 1}`);
        return true;
      }
    }

    console.log(`[Credits] User ${userId} has no credits remaining`);
    return false;
  }

  /**
   * Track document processing (called after successful extraction)
   * This handles the credit deduction and logging
   */
  async trackDocumentProcessed(
    userId: string,
    userPlan: string,
    documentId: string,
    docType: string,
    pageCount: number,
    isMultiDoc: boolean = false,
    childCount: number = 0,
    skipExtraction: boolean = false
  ): Promise<{ success: boolean; creditDeducted: boolean }> {
    const billingPeriod = getCurrentBillingPeriod();

    // Determine if this costs a credit
    // Skip credits for:
    // - "other" docs with skip_extraction (classified but not extracted)
    // - "multi_document" parents with skip_extraction (children will be charged instead)
    const costsCredit = !skipExtraction;
    let creditDeducted = false;

    if (costsCredit) {
      creditDeducted = await this.deductCredit(userId, userPlan);
      if (!creditDeducted) {
        // This shouldn't happen if we check credits before processing
        console.error(`[Credits] Failed to deduct credit for user ${userId}, document ${documentId}`);
      }
    }

    // Ensure usage record exists
    await this.getOrCreateUsageRecord(userId, userPlan);

    // Update docs_processed count
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
        credits_used,
        billing_period
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(
      userId,
      documentId,
      docType || null,
      pageCount ?? null,
      isMultiDoc ? 1 : 0,
      childCount ?? 0,
      skipExtraction ? 1 : 0,
      costsCredit ? 1 : 0,
      billingPeriod
    ).run();

    console.log(`[Usage] User ${userId} processed document ${documentId} (${docType}). Credit deducted: ${creditDeducted}. Pages: ${pageCount}`);

    return { success: true, creditDeducted };
  }

  /**
   * Add permanent credits (from annual bonus or token pack purchase)
   */
  async addPermanentCredits(userId: string, credits: number, reason: string = 'purchase'): Promise<void> {
    // Ensure balance record exists first
    await this.getOrCreateCreditBalance(userId, 'Starter'); // Plan doesn't matter for existing record

    await this.db.prepare(`
      UPDATE user_credit_balance
      SET permanent_credits = permanent_credits + ?,
          updated_at = datetime('now', '-6 hours')
      WHERE user_id = ?
    `).bind(credits, userId).run();

    console.log(`[Credits] Added ${credits} permanent credits for user ${userId} (reason: ${reason})`);
  }

  /**
   * Add purchased credits (from credit pack purchase)
   * These never expire and are consumed after monthly, before bonus
   */
  async addPurchasedCredits(
    userId: string,
    credits: number,
    packName: string,
    priceId: string,
    amountPaid: number,  // in cents
    stripeSessionId?: string,
    stripePaymentIntent?: string
  ): Promise<void> {
    // Ensure balance record exists first
    await this.getOrCreateCreditBalance(userId, 'Starter'); // Plan doesn't matter for existing record

    // Add credits to user balance
    await this.db.prepare(`
      UPDATE user_credit_balance
      SET purchased_credits = purchased_credits + ?,
          updated_at = datetime('now', '-6 hours')
      WHERE user_id = ?
    `).bind(credits, userId).run();

    // Log the purchase for audit trail
    await this.db.prepare(`
      INSERT INTO credit_purchase_history (
        user_id,
        credits,
        price_id,
        pack_name,
        amount_paid,
        stripe_session_id,
        stripe_payment_intent
      ) VALUES (?, ?, ?, ?, ?, ?, ?)
    `).bind(
      userId,
      credits,
      priceId,
      packName,
      amountPaid,
      stripeSessionId || null,
      stripePaymentIntent || null
    ).run();

    console.log(`[Credits] Added ${credits} purchased credits for user ${userId} (pack: ${packName}, price: $${(amountPaid / 100).toFixed(2)})`);
  }

  /**
   * Grant annual bonus credits (called when user subscribes annually)
   */
  async grantAnnualBonus(userId: string, userPlan: string): Promise<void> {
    const tierLimit = getTierLimit(userPlan);
    if (tierLimit.bonus > 0 && !tierLimit.isLifetime) {
      await this.addPermanentCredits(userId, tierLimit.bonus, 'annual_bonus');
      console.log(`[Credits] Granted ${tierLimit.bonus} annual bonus credits to user ${userId} for ${userPlan} plan`);
    }
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
        SUM(credits_used) as total_credits,
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

  // Legacy method for backwards compatibility
  async incrementDocumentCount(
    userId: string,
    documentId: string,
    docType: string,
    pageCount: number,
    isMultiDoc: boolean = false,
    childCount: number = 0,
    skipExtraction: boolean = false
  ): Promise<void> {
    // This is now just a wrapper around trackDocumentProcessed
    // userPlan is not available here, so we can't do proper bucket tracking
    // This method should be deprecated in favor of trackDocumentProcessed
    const billingPeriod = getCurrentBillingPeriod();
    // Skip credits when skipExtraction is true (multi_document parents, "other" docs without extraction)
    const creditsUsed = skipExtraction ? 0 : 1;

    // Ensure usage record exists
    await this.db.prepare(`
      INSERT OR IGNORE INTO document_usage (
        user_id, billing_period_start, docs_processed, monthly_credits_used, credits_used
      ) VALUES (?, ?, 0, 0, 0)
    `).bind(userId, billingPeriod).run();

    // Update counters
    await this.db.prepare(`
      UPDATE document_usage
      SET docs_processed = docs_processed + 1,
          credits_used = credits_used + ?,
          updated_at = datetime('now', '-6 hours')
      WHERE user_id = ? AND billing_period_start = ?
    `).bind(creditsUsed, userId, billingPeriod).run();

    // Log processing
    await this.db.prepare(`
      INSERT INTO document_processing_log (
        user_id, document_id, doc_type, page_count, was_multi_doc, child_count, skip_extraction, credits_used, billing_period
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).bind(userId, documentId, docType || null, pageCount ?? null, isMultiDoc ? 1 : 0, childCount ?? 0, skipExtraction ? 1 : 0, creditsUsed, billingPeriod).run();

    console.log(`[Usage] (legacy) User ${userId} processed document ${documentId}. Credits: ${creditsUsed}`);
  }
}
