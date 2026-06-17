"""OpenAI-kompatibler Provider (NVIDIA NIM u. a.) — nutzt das offizielle openai-SDK.

Verwendet bewusst die **Chat-Completions**-API (nicht die Responses-API), damit
NVIDIA NIM und andere OpenAI-kompatible Endpunkte funktionieren. Reiner
OpenAI-Code, getrennt vom Anthropic-Modul.
"""

from __future__ import annotations

from typing import Any

from openai import AsyncOpenAI

from ..const import (
    CONF_BASE_URL,
    CONF_MAX_TOKENS,
    CONF_MODEL,
    CONF_PROVIDER,
    CONF_TEMPERATURE,
    DEFAULT_BASE_URLS,
    DEFAULT_MAX_TOKENS,
    DEFAULT_MODELS,
    DEFAULT_TEMPERATURE,
    PROVIDER_NVIDIA,
)


def _client(cfg: dict[str, Any]) -> AsyncOpenAI:
    provider = cfg.get(CONF_PROVIDER, PROVIDER_NVIDIA)
    base_url = cfg.get(CONF_BASE_URL) or DEFAULT_BASE_URLS.get(provider)
    return AsyncOpenAI(api_key=cfg["api_key"], base_url=base_url)


async def async_chat(
    cfg: dict[str, Any], system: str, messages: list[dict[str, str]]
) -> str:
    """Eine Konversations-Runde gegen einen OpenAI-kompatiblen Chat-Endpunkt."""
    provider = cfg.get(CONF_PROVIDER, PROVIDER_NVIDIA)
    client = _client(cfg)
    full = [{"role": "system", "content": system}, *messages]
    try:
        response = await client.chat.completions.create(
            model=cfg.get(CONF_MODEL) or DEFAULT_MODELS.get(provider, ""),
            messages=full,
            max_tokens=int(cfg.get(CONF_MAX_TOKENS, DEFAULT_MAX_TOKENS)),
            temperature=float(cfg.get(CONF_TEMPERATURE, DEFAULT_TEMPERATURE)),
        )
    finally:
        await client.close()
    return response.choices[0].message.content or ""


async def async_validate(cfg: dict[str, Any]) -> None:
    """Test-Call: Modell-Liste abrufen (leichtgewichtig, prüft Auth + URL)."""
    client = _client(cfg)
    try:
        await client.models.list()
    finally:
        await client.close()
