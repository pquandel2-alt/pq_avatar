"""Claude-Provider — nutzt ausschließlich das offizielle Anthropic-SDK.

Dieses Modul enthält bewusst NUR Anthropic/Claude-Code (kein OpenAI-Code),
damit die beiden Provider sauber getrennt bleiben.
"""

from __future__ import annotations

from typing import Any

from anthropic import AsyncAnthropic

from ..const import CONF_MAX_TOKENS, CONF_MODEL, DEFAULT_MAX_TOKENS, DEFAULT_MODELS, PROVIDER_ANTHROPIC


async def async_chat(
    cfg: dict[str, Any], system: str, messages: list[dict[str, str]]
) -> str:
    """Eine Konversations-Runde gegen die Anthropic Messages API.

    Wichtig (claude-api-Skill): an Opus/Sonnet 4.x KEIN ``temperature``/``top_p``
    und KEIN ``budget_tokens`` schicken (→ 400). ``thinking`` wird weggelassen
    (= aus) für schnellste Antworten — passend für einen Voice-Assistant.
    """
    client = AsyncAnthropic(api_key=cfg["api_key"])
    try:
        response = await client.messages.create(
            model=cfg.get(CONF_MODEL) or DEFAULT_MODELS[PROVIDER_ANTHROPIC],
            max_tokens=int(cfg.get(CONF_MAX_TOKENS, DEFAULT_MAX_TOKENS)),
            system=system,
            messages=messages,
        )
    finally:
        await client.close()

    for block in response.content:
        if getattr(block, "type", None) == "text":
            return block.text
    return ""


async def async_validate(cfg: dict[str, Any]) -> None:
    """Minimaler Test-Call zur Schlüssel-/Modellprüfung."""
    client = AsyncAnthropic(api_key=cfg["api_key"])
    try:
        await client.messages.create(
            model=cfg.get(CONF_MODEL) or DEFAULT_MODELS[PROVIDER_ANTHROPIC],
            max_tokens=1,
            messages=[{"role": "user", "content": "hi"}],
        )
    finally:
        await client.close()
