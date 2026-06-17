"""Konfigurations-Dialog (UI) für die AI-Avatar-Integration."""

from __future__ import annotations

from typing import Any

import voluptuous as vol

from homeassistant.config_entries import (
    ConfigEntry,
    ConfigFlow,
    ConfigFlowResult,
    OptionsFlow,
)
from homeassistant.const import CONF_API_KEY
from homeassistant.core import callback
from homeassistant.helpers.selector import (
    NumberSelector,
    NumberSelectorConfig,
    NumberSelectorMode,
    SelectSelector,
    SelectSelectorConfig,
    SelectSelectorMode,
    TextSelector,
    TextSelectorConfig,
    TextSelectorType,
)

from .const import (
    ANTHROPIC_MODELS,
    CONF_BASE_URL,
    CONF_GREETING,
    CONF_MAX_TOKENS,
    CONF_MODEL,
    CONF_PIPELINE_ID,
    CONF_PROVIDER,
    CONF_SYSTEM_PROMPT,
    CONF_TEMPERATURE,
    CONF_WAKE_WORD,
    DEFAULT_BASE_URLS,
    DEFAULT_GREETING,
    DEFAULT_MAX_TOKENS,
    DEFAULT_MODELS,
    DEFAULT_SYSTEM_PROMPT,
    DEFAULT_TEMPERATURE,
    DOMAIN,
    PROVIDER_ANTHROPIC,
    PROVIDER_NVIDIA,
    PROVIDER_OPENAI,
    PROVIDERS,
)
from .providers import async_validate

_PASSWORD = TextSelector(TextSelectorConfig(type=TextSelectorType.PASSWORD))


async def _validate(data: dict[str, Any]) -> str | None:
    """Provider-Zugang testen. Gibt einen Fehlercode zurück oder None bei Erfolg."""
    try:
        await async_validate(data)
    except Exception as err:  # noqa: BLE001 - Klassifikation per Typ/Status
        name = type(err).__name__.lower()
        status = getattr(err, "status_code", None) or getattr(err, "status", None)
        if "authentication" in name or "permission" in name or status in (401, 403):
            return "invalid_auth"
        return "cannot_connect"
    return None


class AvatarConfigFlow(ConfigFlow, domain=DOMAIN):
    """Erst Provider wählen, dann Zugangsdaten erfassen."""

    VERSION = 1

    def __init__(self) -> None:
        self._provider: str = PROVIDER_NVIDIA

    async def async_step_user(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        if user_input is not None:
            self._provider = user_input[CONF_PROVIDER]
            return await self.async_step_credentials()

        schema = vol.Schema(
            {
                vol.Required(CONF_PROVIDER, default=PROVIDER_NVIDIA): SelectSelector(
                    SelectSelectorConfig(
                        options=list(PROVIDERS),
                        translation_key="provider",
                        mode=SelectSelectorMode.DROPDOWN,
                    )
                )
            }
        )
        return self.async_show_form(step_id="user", data_schema=schema)

    async def async_step_credentials(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        errors: dict[str, str] = {}
        if user_input is not None:
            data = {CONF_PROVIDER: self._provider, **user_input}
            error = await _validate(data)
            if error:
                errors["base"] = error
            else:
                title = f"AI Avatar ({self._provider})"
                return self.async_create_entry(title=title, data=data)

        provider = self._provider
        fields: dict[Any, Any] = {vol.Required(CONF_API_KEY): _PASSWORD}
        if provider != PROVIDER_ANTHROPIC:
            fields[
                vol.Required(
                    CONF_BASE_URL, default=DEFAULT_BASE_URLS.get(provider, "")
                )
            ] = str
        fields[vol.Required(CONF_MODEL, default=DEFAULT_MODELS[provider])] = (
            _model_selector(provider)
        )

        return self.async_show_form(
            step_id="credentials",
            data_schema=vol.Schema(fields),
            errors=errors,
            description_placeholders={"provider": provider},
        )

    @staticmethod
    @callback
    def async_get_options_flow(config_entry: ConfigEntry) -> OptionsFlow:
        return AvatarOptionsFlow(config_entry)


class AvatarOptionsFlow(OptionsFlow):
    """Feineinstellungen (Modell, Tokens, Prompt, Avatar-Optionen)."""

    def __init__(self, config_entry: ConfigEntry) -> None:
        self.config_entry = config_entry

    async def async_step_init(
        self, user_input: dict[str, Any] | None = None
    ) -> ConfigFlowResult:
        if user_input is not None:
            return self.async_create_entry(title="", data=user_input)

        provider = self.config_entry.data.get(CONF_PROVIDER, PROVIDER_NVIDIA)
        opts = self.config_entry.options
        data = self.config_entry.data

        fields: dict[Any, Any] = {
            vol.Optional(
                CONF_MODEL,
                default=opts.get(CONF_MODEL, data.get(CONF_MODEL, DEFAULT_MODELS[provider])),
            ): _model_selector(provider),
            vol.Optional(
                CONF_MAX_TOKENS, default=opts.get(CONF_MAX_TOKENS, DEFAULT_MAX_TOKENS)
            ): NumberSelector(
                NumberSelectorConfig(min=64, max=8192, step=64, mode=NumberSelectorMode.BOX)
            ),
            vol.Optional(
                CONF_SYSTEM_PROMPT,
                default=opts.get(CONF_SYSTEM_PROMPT, DEFAULT_SYSTEM_PROMPT),
            ): TextSelector(TextSelectorConfig(multiline=True)),
            vol.Optional(
                CONF_GREETING, default=opts.get(CONF_GREETING, DEFAULT_GREETING)
            ): str,
            vol.Optional(
                CONF_WAKE_WORD, default=opts.get(CONF_WAKE_WORD, True)
            ): bool,
            vol.Optional(
                CONF_PIPELINE_ID, default=opts.get(CONF_PIPELINE_ID, "")
            ): str,
        }
        # temperature nur für OpenAI-kompatible Provider (Claude lehnt sie ab)
        if provider != PROVIDER_ANTHROPIC:
            fields[
                vol.Optional(
                    CONF_TEMPERATURE,
                    default=opts.get(CONF_TEMPERATURE, DEFAULT_TEMPERATURE),
                )
            ] = NumberSelector(
                NumberSelectorConfig(min=0, max=2, step=0.1, mode=NumberSelectorMode.SLIDER)
            )

        return self.async_show_form(step_id="init", data_schema=vol.Schema(fields))


def _model_selector(provider: str):
    """Dropdown mit freiem Wert für Anthropic-Modelle, sonst Freitextfeld."""
    if provider == PROVIDER_ANTHROPIC:
        return SelectSelector(
            SelectSelectorConfig(
                options=list(ANTHROPIC_MODELS),
                mode=SelectSelectorMode.DROPDOWN,
                custom_value=True,
            )
        )
    return str
