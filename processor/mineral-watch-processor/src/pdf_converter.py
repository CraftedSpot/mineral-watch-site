"""PDF to image conversion using pdftoppm."""

import asyncio
import logging
import tempfile
from pathlib import Path

from .config import CONFIG

logger = logging.getLogger(__name__)


async def convert_pdf_to_images(pdf_path: str, dpi: int = None) -> list[str]:
    """
    Convert PDF to JPEG images using pdftoppm.
    
    Args:
        pdf_path: Path to the PDF file
        dpi: Resolution for output images (default from config)
    
    Returns:
        List of paths to generated JPEG images
    """
    if dpi is None:
        dpi = CONFIG.IMAGE_DPI
    
    output_dir = tempfile.mkdtemp()
    output_prefix = Path(output_dir) / "page"
    
    logger.info(f"Converting {pdf_path} to images at {dpi} DPI")
    
    # Run pdftoppm
    process = await asyncio.create_subprocess_exec(
        'pdftoppm',
        '-jpeg',
        '-r', str(dpi),
        pdf_path,
        str(output_prefix),
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE
    )
    
    stdout, stderr = await process.communicate()
    
    if process.returncode != 0:
        error_msg = stderr.decode() if stderr else "Unknown error"
        raise RuntimeError(f"pdftoppm failed: {error_msg}")
    
    # Collect output files (pdftoppm names them page-1.jpg, page-2.jpg, etc.)
    image_paths = sorted(Path(output_dir).glob("page-*.jpg"))
    
    if not image_paths:
        raise RuntimeError(f"No images generated from {pdf_path}")
    
    logger.info(f"Generated {len(image_paths)} images from PDF")
    return [str(p) for p in image_paths]


async def get_pdf_page_count(pdf_path: str) -> int:
    """Get the number of pages in a PDF using pdfinfo."""
    process = await asyncio.create_subprocess_exec(
        'pdfinfo',
        pdf_path,
        stdout=asyncio.subprocess.PIPE,
        stderr=asyncio.subprocess.PIPE
    )
    
    stdout, stderr = await process.communicate()
    
    if process.returncode != 0:
        logger.warning(f"pdfinfo failed, falling back to conversion count")
        return 0
    
    # Parse output for "Pages:" line
    for line in stdout.decode().split('\n'):
        if line.startswith('Pages:'):
            return int(line.split(':')[1].strip())
    
    return 0
