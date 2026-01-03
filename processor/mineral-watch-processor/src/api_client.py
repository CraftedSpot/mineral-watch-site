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
    
    async def download_document(self, doc_id: str) -> str:
        """Download a PDF from R2 and return local file path."""
        async with httpx.AsyncClient(timeout=60) as client:
            # Get signed download URL
            response = await client.get(
                f"{self.base_url}/api/processing/download/{doc_id}",
                headers=self.headers
            )
            response.raise_for_status()
            data = response.json()
            download_url = data.get("url")  # Changed from "download_url" to "url"
            
            if not download_url:
                raise ValueError(f"No download URL returned for document {doc_id}")
            
            # Download the actual PDF
            pdf_response = await client.get(download_url, headers=self.headers)
            pdf_response.raise_for_status()
            
            # Save to temp file
            temp_dir = tempfile.mkdtemp()
            pdf_path = Path(temp_dir) / f"{doc_id}.pdf"
            pdf_path.write_bytes(pdf_response.content)
            
            logger.info(f"Downloaded {doc_id} to {pdf_path} ({len(pdf_response.content)} bytes)")
            return str(pdf_path)
    
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
