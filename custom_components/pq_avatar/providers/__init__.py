"""Provider-Abstraktion: einheitliches Interface für Claude und OpenAI-kompatible APIs."""

from __future__ import annotations

from typing import Any

from ..const import CONF_PROVIDER, PROVIDER_ANTHROPIC


async def async_chat(
    cfg: dict[str, Any], system: str, messages: list[dict[str, str]]
) -> str:
    """Dispatch an das passende Provider-Modul. Liefert den Antworttext."""
    if cfg.get(CONF_PROVIDER) == PROVIDER_ANTHROPIC:
        from . import anthropic_provider

        return await anthropic_provider.async_chat(cfg, system, messages)

    from . import openai_provider

    return await openai_provider.async_chat(cfg, system, messages)


async def async_validate(cfg: dict[str, Any]) -> None:
    """Schlüssel/Modell gegen den gewählten Provider prüfen (wirft bei Fehler)."""
    if cfg.get(CONF_PROVIDER) == PROVIDER_ANTHROPIC:
        from . import anthropic_provider

        await anthropic_provider.async_validate(cfg)
        return

    from . import openai_provider

    await openai_provider.async_validate(cfg)
