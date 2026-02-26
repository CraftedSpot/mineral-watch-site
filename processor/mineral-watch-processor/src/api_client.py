"""API client for communicating with the documents-worker."""

import httpx
import logging
import tempfile
from pathlib import Path
from typing import Optional

from .config import CONFIG

logger = logging.getLogger(__name__)


class APIClient:
    """Client for the documents-worker processing API."""
    
    def __init__(self):
        self.base_url = CONFIG.DOCUMENTS_API_URL.rstrip("/")
        self.headers = {
            "X-API-Key": CONFIG.PROCESSING_API_KEY,
            "Content-Type": "application/json"
        }
    
    async def get_queue(self, limit: int = 5) -> list[dict]:
        """Fetch documents from the processing queue."""
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.get(
                f"{self.base_url}/api/processing/queue",
                params={"limit": limit},
                headers=self.headers
            )
            
            if response.status_code == 404:
                logger.warning("Processing queue endpoint not found - may need to be implemented")
                return []
            
            response.raise_for_status()
            data = response.json()
            return data.get("documents", [])
    
    async def download_document(self, doc_id: str, content_type: str = None) -> tuple[str, str]:
        """
        Download a document from R2 and return local file path and detected content type.

        Returns:
            tuple: (file_path, content_type)
        """
        async with httpx.AsyncClient(timeout=60) as client:
            # Get signed download URL
            response = await client.get(
                f"{self.base_url}/api/processing/download/{doc_id}",
                headers=self.headers
            )
            response.raise_for_status()
            data = response.json()
            download_url = data.get("url")
            filename = data.get("filename", "")

            if not download_url:
                raise ValueError(f"No download URL returned for document {doc_id}")

            # Download the actual file
            file_response = await client.get(download_url, headers=self.headers)
            file_response.raise_for_status()

            # Determine content type from response header or filename
            detected_type = file_response.headers.get("Content-Type", "").split(";")[0].strip()
            if not detected_type or detected_type == "application/octet-stream":
                # Infer from filename extension
                ext = Path(filename).suffix.lower() if filename else ""
                ext_to_type = {
                    ".pdf": "application/pdf",
                    ".jpg": "image/jpeg",
                    ".jpeg": "image/jpeg",
                    ".png": "image/png",
                    ".tiff": "image/tiff",
                    ".tif": "image/tiff",
                }
                detected_type = ext_to_type.get(ext, content_type or "application/pdf")

            # Determine file extension
            type_to_ext = {
                "application/pdf": ".pdf",
                "image/jpeg": ".jpg",
                "image/png": ".png",
                "image/tiff": ".tiff",
            }
            extension = type_to_ext.get(detected_type, ".pdf")

            # Save to temp file with correct extension
            temp_dir = tempfile.mkdtemp()
            file_path = Path(temp_dir) / f"{doc_id}{extension}"
            file_path.write_bytes(file_response.content)

            logger.info(f"Downloaded {doc_id} to {file_path} ({len(file_response.content)} bytes, type: {detected_type})")
            return str(file_path), detected_type
    
    async def complete_document(self, doc_id: str, result: dict) -> None:
        """Update document with extraction results."""
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                f"{self.base_url}/api/processing/complete/{doc_id}",
                headers=self.headers,
                json=result
            )
            if response.status_code == 500:
                logger.error(f"500 Error response from documents-worker: {response.text[:1000]}")
            response.raise_for_status()
            logger.info(f"Updated document {doc_id} with status: {result.get('status')}")
    
    async def split_document(self, doc_id: str, children: list[dict]) -> None:
        """Create child documents from a multi-document PDF."""
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                f"{self.base_url}/api/processing/split/{doc_id}",
                headers=self.headers,
                json={"children": children}
            )
            response.raise_for_status()
            logger.info(f"Split document {doc_id} into {len(children)} children")
    
    async def complete_prescan(self, doc_id: str, result: dict) -> None:
        """Update document with prescan results."""
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                f"{self.base_url}/api/processing/prescan-complete/{doc_id}",
                headers=self.headers,
                json=result
            )
            response.raise_for_status()
            logger.info(f"Prescan complete for {doc_id}: {len(result.get('chunks', []))} chunks")

    async def upload_ocr_cache(self, doc_id: str, page_texts: list[str]) -> None:
        """Upload OCR text cache to R2."""
        async with httpx.AsyncClient(timeout=30) as client:
            response = await client.post(
                f"{self.base_url}/api/processing/ocr-cache/{doc_id}",
                headers=self.headers,
                json=page_texts
            )
            response.raise_for_status()
            logger.info(f"Uploaded OCR cache for {doc_id} ({len(page_texts)} pages)")

    async def get_ocr_cache(self, doc_id: str) -> Optional[list[str]]:
        """Get cached OCR text from R2. Returns None if no cache."""
        async with httpx.AsyncClient(timeout=30) as client:
            try:
                response = await client.get(
                    f"{self.base_url}/api/processing/ocr-cache/{doc_id}",
                    headers=self.headers
                )
                if response.status_code == 404:
                    return None
                response.raise_for_status()
                return response.json()
            except httpx.HTTPStatusError:
                return None

    async def delete_ocr_cache(self, doc_id: str) -> None:
        """Delete OCR text cache from R2."""
        async with httpx.AsyncClient(timeout=60) as client:
            try:
                response = await client.delete(
                    f"{self.base_url}/api/processing/ocr-cache/{doc_id}",
                    headers=self.headers
                )
                if response.status_code != 404:
                    response.raise_for_status()
                logger.info(f"Deleted OCR cache for {doc_id}")
            except httpx.HTTPStatusError as e:
                logger.warning(f"Failed to delete OCR cache for {doc_id}: {e}")

    async def get_user_info(self, user_id: str) -> Optional[dict]:
        """Get user info for notifications."""
        async with httpx.AsyncClient(timeout=30) as client:
            try:
                response = await client.get(
                    f"{self.base_url}/api/processing/user/{user_id}",
                    headers=self.headers
                )
                response.raise_for_status()
                return response.json()
            except httpx.HTTPStatusError as e:
                logger.warning(f"Could not fetch user info for {user_id}: {e}")
                return None
    
    async def get_user_queue_status(self, user_id: str) -> dict:
        """Check how many documents a user has remaining in queue."""
        async with httpx.AsyncClient(timeout=30) as client:
            try:
                response = await client.get(
                    f"{self.base_url}/api/processing/user/{user_id}/queue-status",
                    headers=self.headers
                )
                response.raise_for_status()
                return response.json()
            except httpx.HTTPStatusError:
                return {"queued": 0, "processing": 0}
