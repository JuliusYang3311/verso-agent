#!/usr/bin/env python3
"""
Configuration for videogeneration skill.
Provides compatibility with MoneyPrinterTurbo config patterns.
"""

import json
import os
from pathlib import Path


def _load_verso_config() -> dict:
    """Load Verso configuration from verso.json."""
    config_path = Path.home() / ".verso" / "verso.json"
    if config_path.exists():
        try:
            with open(config_path, "r") as f:
                return json.load(f)
        except Exception as e:
            print(f"Warning: Could not load verso.json: {e}")
    return {}


class AppConfig:
    """Application configuration compatible with MoneyPrinterTurbo."""
    
    def __init__(self):
        self._verso_config = _load_verso_config()
        self._vg_config = self._verso_config.get("videoGeneration", {})
    
    def get(self, key: str, default=None):
        """Get a configuration value."""
        # Map MoneyPrinterTurbo keys to our config
        key_map = {
            "pexels_api_keys": ("pexelsApiKey", "PEXELS_API_KEY"),
            "pixabay_api_keys": ("pixabayApiKey", "PIXABAY_API_KEY"),
        }
        
        if key in key_map:
            config_key, env_key = key_map[key]
            value = self._vg_config.get(config_key) or os.environ.get(env_key, "")
            return value if value else default
        
        return self._vg_config.get(key, default)
    
    def __getitem__(self, key: str):
        return self.get(key)


class Config:
    """Main configuration class."""
    
    def __init__(self):
        self.app = AppConfig()
        self.proxy = None
        self.config_file = str(Path.home() / ".verso" / "verso.json")


# Global config instance
config = Config()
