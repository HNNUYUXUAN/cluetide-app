"""Secrets remain local and are never serialized into cases or reports."""
import os
from pathlib import Path
from dotenv import load_dotenv

ROOT = Path(__file__).resolve().parents[2]
LOCAL_DATA = ROOT / "local-data"
load_dotenv(ROOT / ".env", override=False)


def gateway_key() -> str:
    return os.environ.get("TOKENDANCE_API_KEY", "")


def ethereum_endpoint() -> str:
    return os.environ.get("ETHEREUM_RPC_URL", "https://mainnet.gateway.tenderly.co")


def ethereum_provider_label() -> str:
    """Publish only a known provider label; custom configuration stays private."""
    endpoint = ethereum_endpoint().rstrip("/")
    return {"https://mainnet.gateway.tenderly.co": "public_tenderly",
            "https://ethereum-rpc.publicnode.com": "publicnode"}.get(endpoint, "locally_configured_rpc")
