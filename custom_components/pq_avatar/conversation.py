"""Conversation-Agent — registriert „AI Avatar" als wählbaren Pipeline-Agent."""

from __future__ import annotations

import logging
from typing import Any

from homeassistant.components import conversation
from homeassistant.config_entries import ConfigEntry
from homeassistant.const import MATCH_ALL
from homeassistant.core import HomeAssistant
from homeassistant.helpers import intent
from homeassistant.helpers.entity_platform import AddEntitiesCallback
from homeassistant.util import ulid as ulid_util

from .const import (
    CONF_SYSTEM_PROMPT,
    DEFAULT_SYSTEM_PROMPT,
    DOMAIN,
    HISTORY_TURNS,
)
from .providers import async_chat

_LOGGER = logging.getLogger(__name__)


async def async_setup_entry(
    hass: HomeAssistant,
    entry: ConfigEntry,
    async_add_entities: AddEntitiesCallback,
) -> None:
    """Conversation-Entity für diesen Config-Entry anlegen."""
    async_add_entities([AvatarConversationEntity(entry)])


class AvatarConversationEntity(
    conversation.ConversationEntity, conversation.AbstractConversationAgent
):
    """Sprach-/Chat-Agent, der an den konfigurierten LLM-Provider weiterleitet."""

    _attr_has_entity_name = True
    _attr_name = "AI Avatar"

    def __init__(self, entry: ConfigEntry) -> None:
        self.entry = entry
        self._attr_unique_id = entry.entry_id
        self._history: dict[str, list[dict[str, str]]] = {}

    @property
    def supported_languages(self) -> list[str] | str:
        return MATCH_ALL

    async def async_added_to_hass(self) -> None:
        await super().async_added_to_hass()
        self.entry.async_on_unload(self._history.clear)

    def _cfg(self) -> dict[str, Any]:
        return {**self.entry.data, **self.entry.options}

    async def async_process(
        self, user_input: conversation.ConversationInput
    ) -> conversation.ConversationResult:
        """Eine Nutzeräußerung verarbeiten und die LLM-Antwort zurückgeben."""
        cfg = self._cfg()
        system = cfg.get(CONF_SYSTEM_PROMPT) or DEFAULT_SYSTEM_PROMPT
        conversation_id = user_input.conversation_id or ulid_util.ulid_now()

        history = self._history.get(conversation_id, [])
        history = [*history, {"role": "user", "content": user_input.text}]

        response = intent.IntentResponse(language=user_input.language)
        try:
            reply = await async_chat(cfg, system, history)
        except Exception as err:  # noqa: BLE001 - alle Provider-/Netzfehler abfangen
            _LOGGER.error("AI-Avatar-Provider-Fehler: %s", err)
            response.async_set_error(
                intent.IntentResponseErrorCode.UNKNOWN,
                f"Entschuldigung, es gab einen Fehler: {err}",
            )
            return conversation.ConversationResult(
                response=response, conversation_id=conversation_id
            )

        history.append({"role": "assistant", "content": reply})
        self._history[conversation_id] = history[-HISTORY_TURNS * 2 :]

        response.async_set_speech(reply)
        return conversation.ConversationResult(
            response=response, conversation_id=conversation_id
        )
