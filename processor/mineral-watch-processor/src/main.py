"""
Mineral Watch Document Processor

A background service that processes uploaded documents:
1. Polls for queued documents
2. Downloads PDFs from R2
3. Converts to images using pdftoppm
4. Extracts data using Claude Vision
5. Updates database with results
6. Notifies users when complete
"""

import asyncio
import json
import logging
import os
import shutil
from aiohttp import web
from pathlib import Path
from PIL import Image

from .config import CONFIG
from .api_client import APIClient
from .pdf_converter import convert_pdf_to_images
from .extractor import extract_document_data
from .smart_naming import generate_display_name, generate_display_name_for_child
from .notifier import send_completion_email, send_failure_email

# Configure logging
log_level = os.environ.get("LOG_LEVEL", "INFO")
logging.basicConfig(
    level=getattr(logging, log_level),
    format='%(asctime)s - %(name)s - %(levelname)s - %(message)s'
)
logger = logging.getLogger(__name__)

# Track processor status for health checks
processor_status = {
    "healthy": True,
    "last_poll": None,
    "documents_processed": 0,
    "errors": 0
}


def cleanup_temp_files(*paths):
    """Remove temporary files and directories."""
    for path in paths:
        if path:
            try:
                p = Path(path)
                if p.is_file():
                    p.unlink()
                elif p.is_dir():
                    shutil.rmtree(p)
                else:
                    # Might be parent dir of a file
                    parent = p.parent
                    if parent.exists() and str(parent).startswith('/tmp'):
                        shutil.rmtree(parent)
            except Exception as e:
                logger.warning(f"Failed to cleanup {path}: {e}")


def convert_tiff_to_png(tiff_path: str) -> str:
    """Convert a TIFF image to PNG format for Claude Vision compatibility."""
    png_path = str(Path(tiff_path).with_suffix('.png'))
    try:
        with Image.open(tiff_path) as img:
            # Convert to RGB if necessary (TIFF can have various modes)
            if img.mode in ('RGBA', 'LA') or (img.mode == 'P' and 'transparency' in img.info):
                img = img.convert('RGBA')
            elif img.mode != 'RGB':
                img = img.convert('RGB')
            img.save(png_path, 'PNG')
        logger.info(f"Converted TIFF to PNG: {png_path}")
        return png_path
    except Exception as e:
        logger.error(f"Failed to convert TIFF to PNG: {e}")
        raise


def apply_exif_orientation(image_path: str) -> tuple[str, bool]:
    """
    Apply EXIF orientation to an image if present.

    Args:
        image_path: Path to the image file

    Returns:
        tuple: (corrected_path, was_corrected)
        - corrected_path: Path to the corrected image (may be same as input)
        - was_corrected: True if EXIF orientation was applied
    """
    from PIL import ImageOps

    try:
        with Image.open(image_path) as img:
            # Check if image has EXIF orientation data
            exif = img.getexif() if hasattr(img, 'getexif') else None
            has_orientation = exif and 274 in exif  # 274 is the Orientation tag

            if has_orientation:
                # Apply EXIF transpose
                corrected = ImageOps.exif_transpose(img)
                if corrected is not img:
                    # Save corrected image
                    corrected_path = str(Path(image_path).with_suffix('.corrected.jpg'))
                    corrected.save(corrected_path, 'JPEG', quality=95)
                    logger.info(f"Applied EXIF orientation correction: {corrected_path}")
                    return corrected_path, True

            return image_path, False
    except Exception as e:
        logger.warning(f"Failed to check/apply EXIF orientation: {e}")
        return image_path, False


def rotate_image(image_path: str, degrees: int) -> str:
    """
    Rotate an image by the specified degrees clockwise.

    Args:
        image_path: Path to the image file
        degrees: Rotation in degrees (90, 180, or 270)

    Returns:
        Path to the rotated image
    """
    try:
        with Image.open(image_path) as img:
            # PIL's rotate is counter-clockwise, so we negate
            # Also use expand=True to adjust canvas size for 90/270 rotations
            rotated = img.rotate(-degrees, expand=True)

            rotated_path = str(Path(image_path).with_suffix(f'.rotated{degrees}.jpg'))
            rotated.save(rotated_path, 'JPEG', quality=95)
            logger.info(f"Rotated image {degrees}° clockwise: {rotated_path}")
            return rotated_path
    except Exception as e:
        logger.error(f"Failed to rotate image: {e}")
        raise


async def process_document(client: APIClient, doc: dict) -> dict:
    """
    Process a single document through the extraction pipeline.

    Returns dict with processing result info for notification tracking.
    """
    doc_id = doc['id']
    original_filename = doc.get('original_filename', doc.get('filename', 'document.pdf'))
    user_id = doc.get('user_id')
    content_type_hint = doc.get('content_type')  # May be provided by queue

    logger.info(f"Processing document {doc_id}: {original_filename}")

    file_path = None
    image_paths = []
    converted_tiff_path = None  # Track converted TIFF for cleanup

    try:
        # 1. Download document from R2
        file_path, content_type = await client.download_document(doc_id, content_type_hint)
        logger.info(f"Downloaded file type: {content_type}")

        # 2. Prepare images based on file type
        is_direct_image = False  # Track if this is a directly uploaded image (not PDF)

        if content_type == 'application/pdf':
            # PDF: Convert to images using pdftoppm (handles rotation internally)
            image_paths = await convert_pdf_to_images(file_path)
            page_count = len(image_paths)
            logger.info(f"Converted PDF to {page_count} pages")
        elif content_type in ('image/jpeg', 'image/png'):
            # JPEG/PNG: Apply EXIF orientation if present
            is_direct_image = True
            corrected_path, was_corrected = apply_exif_orientation(file_path)
            if was_corrected:
                image_paths = [corrected_path]
            else:
                image_paths = [file_path]
            page_count = 1
            logger.info(f"Using image directly: {content_type} (EXIF corrected: {was_corrected})")
        elif content_type == 'image/tiff':
            # TIFF: Convert to PNG first (Claude Vision doesn't support TIFF)
            is_direct_image = True
            converted_tiff_path = convert_tiff_to_png(file_path)
            image_paths = [converted_tiff_path]
            page_count = 1
            logger.info(f"Converted TIFF to PNG for processing")
        else:
            # Unknown type - try as PDF
            logger.warning(f"Unknown content type {content_type}, attempting PDF conversion")
            image_paths = await convert_pdf_to_images(file_path)
            page_count = len(image_paths)

        logger.info(f"Prepared {page_count} image(s) for extraction")

        # 3. Extract with Claude Vision
        # Pass PDF path for deterministic splitting (only for actual PDFs)
        pdf_path_for_splitting = file_path if content_type == 'application/pdf' else None
        extraction_result = await extract_document_data(image_paths, pdf_path=pdf_path_for_splitting)
        
        # 4. Check for multi-document PDF
        if extraction_result.get('is_multi_document'):
            await handle_multi_document(client, doc_id, extraction_result, doc)
            return {
                'status': 'complete',
                'user_id': user_id,
                'is_multi': True,
                'child_count': len(extraction_result.get('documents', []))
            }
        
        # Check if extraction was skipped (for "other" documents)
        if extraction_result.get('skip_extraction'):
            logger.info(f"Document {doc_id} classified as 'other', skipping extraction")

            # Set variables for logging at end of function
            display_name = original_filename
            # "other" documents go to unprocessed - no credit charged, user can review/reclassify
            status = 'unprocessed'

            # Minimal result for "other" documents
            result = {
                'status': status,
                'category': 'other',
                'doc_type': 'other',
                'display_name': display_name,
                'confidence': extraction_result.get('document_confidence', 'high'),
                'extracted_data': {
                    'doc_type': 'other',
                    'classification_model': extraction_result.get('classification_model'),
                    'classification_scores': extraction_result.get('classification_scores', {}),
                    'ai_observations': extraction_result.get('ai_observations'),
                    'skip_extraction': True
                },
                'page_count': page_count,
                'needs_review': False,
                'extraction_error': None
            }
        else:
            # Normal extraction flow
            # 5. Generate smart name
            display_name = generate_display_name(extraction_result)
            logger.info(f"Generated display_name for {doc_id}: {display_name}")
            
            # 6. Determine status based on confidence
            doc_confidence = extraction_result.get('document_confidence', 'medium')
            if doc_confidence == 'low':
                status = 'manual_review'
            else:
                status = 'complete'
            
            # 7. Build result payload
            legal = extraction_result.get('legal_description', {})
            # Handle case where LLM returns string instead of dict
            if not isinstance(legal, dict):
                legal = {}
            
            # Extract recording info for database columns
            recording_book = extraction_result.get('recording_book')
            recording_page = extraction_result.get('recording_page')
            
            # Try old format as fallback for backwards compatibility
            if not recording_book or not recording_page:
                recording_info = extraction_result.get('recording_info', {})
                # Handle case where recording_info is a list (multi-doc) - use first entry
                if isinstance(recording_info, list) and len(recording_info) > 0:
                    recording_info = recording_info[0] if isinstance(recording_info[0], dict) else {}
                elif not isinstance(recording_info, dict):
                    recording_info = {}
                recording_book = recording_book or recording_info.get('book')
                recording_page = recording_page or recording_info.get('page')
            
            result = {
                'status': status,
                'category': extraction_result.get('doc_type', 'other'),
                'doc_type': extraction_result.get('doc_type'),
                'display_name': display_name,
                'confidence': doc_confidence,
                'county': legal.get('county'),
                'section': str(legal.get('section')) if legal.get('section') is not None else None,
                'township': legal.get('township'),
                'range': legal.get('range'),
                'recording_book': recording_book,
                'recording_page': recording_page,
                'extracted_data': extraction_result,
                'page_count': page_count,
                'needs_review': status == 'manual_review',
                'field_scores': extraction_result.get('field_scores'),
                'fields_needing_review': extraction_result.get('fields_needing_review', []),
                'extraction_error': None,  # No error for successful extractions
                'rotation_applied': extraction_result.get('rotation_applied', 0)
            }
        
        # 8. Update database
        logger.info(f"Sending result to documents-worker: {json.dumps(result, indent=2)[:500]}...")
        await client.complete_document(doc_id, result)
        
        logger.info(f"Completed document {doc_id}: {display_name} ({status})")
        
        return {
            'status': status,
            'user_id': user_id,
            'is_multi': False,
            'needs_review': status == 'manual_review'
        }
        
    except Exception as e:
        logger.error(f"Failed to process {doc_id}: {e}", exc_info=True)
        
        # Update document as failed
        try:
            await client.complete_document(doc_id, {
                'status': 'failed',
                'extraction_error': str(e)
            })
        except Exception as update_error:
            logger.error(f"Failed to update document status: {update_error}")
        
        return {
            'status': 'failed',
            'user_id': user_id,
            'error': str(e)
        }
        
    finally:
        # Cleanup temp files
        cleanup_temp_files(file_path, converted_tiff_path, *image_paths)


async def handle_multi_document(
    client: APIClient,
    parent_doc_id: str,
    extraction_result: dict,
    parent_doc: dict
) -> None:
    """Handle a PDF that contains multiple logical documents."""

    documents = extraction_result.get('documents', [])

    logger.info(f"Document {parent_doc_id} contains {len(documents)} logical documents")

    children = []
    for i, doc_data in enumerate(documents):
        # Boundaries are embedded in the document data as _start_page and _end_page
        page_start = doc_data.get('_start_page', 1)
        page_end = doc_data.get('_end_page', page_start)
        
        # Generate name for child
        display_name = generate_display_name_for_child(doc_data, page_start, page_end)
        
        # Determine confidence/status
        # Check for extraction errors first
        if doc_data.get('error'):
            doc_confidence = 'low'
            status = 'failed'
            logger.warning(f"Document {i+1} (pages {page_start}-{page_end}) had extraction error: {doc_data.get('error')}")
        # For skip_extraction documents (coarse_type="other"), mark as unprocessed
        elif doc_data.get('skip_extraction'):
            doc_confidence = 'medium'
            status = 'unprocessed'  # User can decide to process later
        else:
            doc_confidence = doc_data.get('document_confidence', 'medium')
            status = 'manual_review' if doc_confidence == 'low' else 'complete'
        
        legal = doc_data.get('legal_description', {})
        # Handle case where LLM returns string instead of dict
        if not isinstance(legal, dict):
            legal = {}

        # Extract TRS - check both legal_description (deeds) and top-level (division orders)
        county = legal.get('county') or doc_data.get('county')
        section = legal.get('section') if legal.get('section') is not None else doc_data.get('section')
        township = legal.get('township') or doc_data.get('township')
        range_val = legal.get('range') or doc_data.get('range')

        # Extract recording info
        recording_book = doc_data.get('recording_book')
        recording_page = doc_data.get('recording_page')

        # Try old format as fallback
        if not recording_book or not recording_page:
            recording_info = doc_data.get('recording_info', {})
            # Handle case where LLM returns string or list instead of dict
            if isinstance(recording_info, list) and len(recording_info) > 0:
                recording_info = recording_info[0] if isinstance(recording_info[0], dict) else {}
            elif not isinstance(recording_info, dict):
                recording_info = {}
            recording_book = recording_book or recording_info.get('book')
            recording_page = recording_page or recording_info.get('page')

        children.append({
            'page_range_start': page_start,
            'page_range_end': page_end,
            'category': doc_data.get('doc_type', 'other'),
            'doc_type': doc_data.get('doc_type'),
            'display_name': display_name,
            'status': status,
            'confidence': doc_confidence,
            'county': county,
            'section': str(section) if section is not None else None,
            'township': township,
            'range': range_val,
            'recording_book': recording_book,
            'recording_page': recording_page,
            'extracted_data': doc_data,
            'needs_review': status == 'manual_review',
            'field_scores': doc_data.get('field_scores'),
            'fields_needing_review': doc_data.get('fields_needing_review', [])
        })
    
    # Create child records via API
    await client.split_document(parent_doc_id, children)
    
    logger.info(f"Created {len(children)} child documents from {parent_doc_id}")


async def check_and_notify_user(
    client: APIClient,
    user_id: str,
    processing_results: list[dict]
) -> None:
    """
    Check if user has completed all their queued docs and send notification.
    
    Args:
        client: API client
        user_id: User to check
        processing_results: Results from this batch of processing
    """
    # Check if user has any remaining queued docs
    queue_status = await client.get_user_queue_status(user_id)
    
    remaining_queued = queue_status.get('queued', 0)
    remaining_processing = queue_status.get('processing', 0)
    
    if remaining_queued > 0 or remaining_processing > 0:
        logger.debug(f"User {user_id} still has {remaining_queued} queued, {remaining_processing} processing")
        return
    
    # Get user info for email
    user_info = await client.get_user_info(user_id)
    if not user_info:
        logger.warning(f"Could not get user info for {user_id}, skipping notification")
        return
    
    # Count results for this user in this batch
    user_results = [r for r in processing_results if r.get('user_id') == user_id]
    
    completed = sum(1 for r in user_results if r.get('status') in ('complete', 'manual_review'))
    needs_review = sum(1 for r in user_results if r.get('needs_review'))
    failed = sum(1 for r in user_results if r.get('status') == 'failed')
    
    if completed > 0:
        await send_completion_email(
            user_email=user_info.get('email'),
            user_name=user_info.get('name'),
            doc_count=completed,
            docs_needing_review=needs_review
        )
    
    if failed > 0:
        await send_failure_email(
            user_email=user_info.get('email'),
            user_name=user_info.get('name'),
            doc_count=failed
        )


async def main():
    """Main polling loop."""
    
    # Validate configuration
    missing = CONFIG.validate()
    if missing:
        logger.error(f"Missing required configuration: {', '.join(missing)}")
        logger.error("Set these environment variables and restart.")
        return
    
    client = APIClient()
    
    logger.info("="*60)
    logger.info("Mineral Watch Document Processor")
    logger.info(f"API URL: {CONFIG.DOCUMENTS_API_URL}")
    logger.info(f"Poll interval: {CONFIG.POLL_INTERVAL_SECONDS}s")
    logger.info(f"Batch size: {CONFIG.BATCH_SIZE}")
    logger.info(f"Claude model: {CONFIG.CLAUDE_MODEL}")
    logger.info("="*60)
    
    while True:
        try:
            # Update last poll time
            from datetime import datetime
            processor_status["last_poll"] = datetime.utcnow().isoformat()
            
            # Get queued documents
            docs = await client.get_queue(limit=CONFIG.BATCH_SIZE)
            
            if docs:
                logger.info(f"Found {len(docs)} documents to process")
                
                # Track users and results for notifications
                processing_results = []
                users_in_batch = set()
                
                for doc in docs:
                    user_id = doc.get('user_id')
                    if user_id:
                        users_in_batch.add(user_id)
                    
                    result = await process_document(client, doc)
                    processing_results.append(result)
                    
                    # Update stats
                    if result.get('status') == 'failed':
                        processor_status["errors"] += 1
                    else:
                        processor_status["documents_processed"] += 1
                
                # Check if any users are now complete and should be notified
                for user_id in users_in_batch:
                    await check_and_notify_user(client, user_id, processing_results)
                
                logger.info(f"Batch complete. Processed {len(docs)} documents.")
            else:
                logger.debug("No documents in queue")
            
            processor_status["healthy"] = True
            
            # Wait before next poll
            await asyncio.sleep(CONFIG.POLL_INTERVAL_SECONDS)
            
        except KeyboardInterrupt:
            logger.info("Shutting down...")
            break
        except Exception as e:
            logger.error(f"Error in main loop: {e}", exc_info=True)
            processor_status["errors"] += 1
            # Back off on error
            await asyncio.sleep(60)


# Health check HTTP handlers
async def health_handler(request):
    """Health check endpoint for Fly.io."""
    return web.json_response({
        "status": "healthy" if processor_status["healthy"] else "unhealthy",
        "last_poll": processor_status["last_poll"],
        "documents_processed": processor_status["documents_processed"],
        "errors": processor_status["errors"]
    })


async def root_handler(request):
    """Root endpoint."""
    return web.Response(text="Mineral Watch Document Processor")


async def start_health_server():
    """Start the health check HTTP server."""
    app = web.Application()
    app.router.add_get("/", root_handler)
    app.router.add_get("/health", health_handler)
    
    runner = web.AppRunner(app)
    await runner.setup()
    
    port = int(os.environ.get("PORT", "8080"))
    site = web.TCPSite(runner, "0.0.0.0", port)
    await site.start()
    
    logger.info(f"Health check server running on port {port}")


async def run_all():
    """Run both the health server and the main processing loop."""
    # Start health check server
    await start_health_server()
    
    # Run main processing loop
    await main()


if __name__ == "__main__":
    asyncio.run(run_all())
