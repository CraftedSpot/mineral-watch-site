"""Configuration from environment variables."""

import os


class Config:
    """Application configuration from environment variables."""
    
    # API URLs and keys
    DOCUMENTS_API_URL: str = os.environ.get("DOCUMENTS_API_URL", "")
    PROCESSING_API_KEY: str = os.environ.get("PROCESSING_API_KEY", "")
    ANTHROPIC_API_KEY: str = os.environ.get("ANTHROPIC_API_KEY", "")
    POSTMARK_API_KEY: str = os.environ.get("POSTMARK_API_KEY", "")
    
    # Processing settings
    POLL_INTERVAL_SECONDS: int = int(os.environ.get("POLL_INTERVAL_SECONDS", "30"))
    BATCH_SIZE: int = int(os.environ.get("BATCH_SIZE", "5"))
    MAX_RETRIES: int = int(os.environ.get("MAX_RETRIES", "3"))
    
    # Claude model
    CLAUDE_MODEL: str = os.environ.get("CLAUDE_MODEL", "claude-sonnet-4-5-20250929")
    
    # Image conversion
    IMAGE_DPI: int = int(os.environ.get("IMAGE_DPI", "150"))
    
    # Email settings
    FROM_EMAIL: str = os.environ.get("FROM_EMAIL", "notifications@mymineralwatch.com")
    
    def validate(self) -> list[str]:
        """Validate required configuration. Returns list of missing items."""
        missing = []
        if not self.DOCUMENTS_API_URL:
            missing.append("DOCUMENTS_API_URL")
        if not self.PROCESSING_API_KEY:
            missing.append("PROCESSING_API_KEY")
        if not self.ANTHROPIC_API_KEY:
            missing.append("ANTHROPIC_API_KEY")
        if not self.POSTMARK_API_KEY:
            missing.append("POSTMARK_API_KEY")
        return missing


CONFIG = Config()
