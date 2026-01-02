"""Email notifications via Postmark."""

import httpx
import logging

from .config import CONFIG

logger = logging.getLogger(__name__)


async def send_completion_email(
    user_email: str,
    user_name: str,
    doc_count: int,
    docs_needing_review: int = 0
) -> bool:
    """
    Send completion notification via Postmark.
    
    Args:
        user_email: Recipient email address
        user_name: Recipient name for personalization
        doc_count: Number of documents processed
        docs_needing_review: Number that need manual review
    
    Returns:
        True if email sent successfully, False otherwise
    """
    if not user_email:
        logger.warning("No email address provided, skipping notification")
        return False
    
    # Build subject line
    if doc_count == 1:
        subject = "Your document is ready to review"
    else:
        subject = f"Your {doc_count} documents are ready to review"
    
    # Build review notice if needed
    review_notice = ""
    if docs_needing_review > 0:
        if docs_needing_review == 1:
            review_notice = """
            <p style="color: #92400e; background: #fef3c7; padding: 12px; border-radius: 6px;">
                ⚠️ 1 document needs your review - some fields couldn't be read clearly.
            </p>
            """
        else:
            review_notice = f"""
            <p style="color: #92400e; background: #fef3c7; padding: 12px; border-radius: 6px;">
                ⚠️ {docs_needing_review} documents need your review - some fields couldn't be read clearly.
            </p>
            """
    
    # Build HTML body
    html_body = f"""
    <html>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #1a1a1a;">Document Processing Complete</h2>
        
        <p>Hi {user_name or 'there'},</p>
        
        <p>Great news! We've finished processing your {doc_count} document{'s' if doc_count > 1 else ''}. 
        {'They are' if doc_count > 1 else 'It is'} now available in your Digital Locker with extracted 
        information including document type, legal descriptions, and parties involved.</p>
        
        {review_notice}
        
        <p><a href="https://portal.mymineralwatch.com/?tab=documents" 
              style="display: inline-block; background: #1D6F5C; color: white; padding: 12px 24px; 
                     text-decoration: none; border-radius: 6px; font-weight: 500;">
            View Your Documents
        </a></p>
        
        <p style="color: #666; font-size: 14px; margin-top: 30px;">
            Fields marked with a warning icon may need verification against the original document.
            You can view the original PDF and correct any extraction errors directly in your portal.
        </p>
        
        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
        
        <p style="color: #999; font-size: 12px;">
            Mineral Watch • Protecting Your Mineral Rights<br>
            <a href="https://mymineralwatch.com" style="color: #999;">mymineralwatch.com</a>
        </p>
    </body>
    </html>
    """
    
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                "https://api.postmarkapp.com/email",
                headers={
                    "X-Postmark-Server-Token": CONFIG.POSTMARK_API_KEY,
                    "Content-Type": "application/json"
                },
                json={
                    "From": CONFIG.FROM_EMAIL,
                    "To": user_email,
                    "Subject": subject,
                    "HtmlBody": html_body,
                    "MessageStream": "outbound"
                }
            )
            
            if response.status_code == 200:
                logger.info(f"Sent completion email to {user_email}")
                return True
            else:
                logger.error(f"Postmark error ({response.status_code}): {response.text}")
                return False
                
    except Exception as e:
        logger.error(f"Failed to send email to {user_email}: {e}")
        return False


async def send_failure_email(
    user_email: str,
    user_name: str,
    doc_count: int,
    error_summary: str = None
) -> bool:
    """
    Send notification when processing fails.
    
    Args:
        user_email: Recipient email address
        user_name: Recipient name for personalization
        doc_count: Number of documents that failed
        error_summary: Optional error description
    
    Returns:
        True if email sent successfully, False otherwise
    """
    if not user_email:
        return False
    
    subject = f"Document processing issue - {doc_count} document{'s' if doc_count > 1 else ''}"
    
    error_text = ""
    if error_summary:
        error_text = f"<p><strong>Details:</strong> {error_summary}</p>"
    
    html_body = f"""
    <html>
    <body style="font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif; max-width: 600px; margin: 0 auto; padding: 20px;">
        <h2 style="color: #1a1a1a;">Document Processing Issue</h2>
        
        <p>Hi {user_name or 'there'},</p>
        
        <p>We encountered an issue processing {doc_count} of your document{'s' if doc_count > 1 else ''}. 
        This can happen with very faded scans, unusual document formats, or corrupted files.</p>
        
        {error_text}
        
        <p><strong>What you can do:</strong></p>
        <ul>
            <li>Check that the PDF is readable and not password-protected</li>
            <li>Try re-scanning at a higher resolution (300 DPI recommended)</li>
            <li>Contact us if the problem persists</li>
        </ul>
        
        <p><a href="https://portal.mymineralwatch.com/?tab=documents" 
              style="display: inline-block; background: #1D6F5C; color: white; padding: 12px 24px; 
                     text-decoration: none; border-radius: 6px; font-weight: 500;">
            View Your Documents
        </a></p>
        
        <hr style="border: none; border-top: 1px solid #eee; margin: 30px 0;">
        
        <p style="color: #999; font-size: 12px;">
            Mineral Watch • Protecting Your Mineral Rights<br>
            <a href="https://mymineralwatch.com" style="color: #999;">mymineralwatch.com</a>
        </p>
    </body>
    </html>
    """
    
    try:
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                "https://api.postmarkapp.com/email",
                headers={
                    "X-Postmark-Server-Token": CONFIG.POSTMARK_API_KEY,
                    "Content-Type": "application/json"
                },
                json={
                    "From": CONFIG.FROM_EMAIL,
                    "To": user_email,
                    "Subject": subject,
                    "HtmlBody": html_body,
                    "MessageStream": "outbound"
                }
            )
            
            if response.status_code == 200:
                logger.info(f"Sent failure email to {user_email}")
                return True
            else:
                logger.error(f"Postmark error ({response.status_code}): {response.text}")
                return False
                
    except Exception as e:
        logger.error(f"Failed to send email to {user_email}: {e}")
        return False
