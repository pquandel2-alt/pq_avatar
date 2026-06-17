"""AI-Avatar-Integration: Multi-Provider-Conversation-Agent + gebündeltes Avatar-Frontend."""

from __future__ import annotations

import logging
from pathlib import Path

from homeassistant.components import frontend, panel_custom
from homeassistant.components.http import StaticPathConfig
from homeassistant.config_entries import ConfigEntry
from homeassistant.core import HomeAssistant

from .const import (
    CONF_GREETING,
    CONF_PIPELINE_ID,
    CONF_WAKE_WORD,
    DEFAULT_GREETING,
    DOMAIN,
    FRONTEND_URL,
    PANEL_ICON,
    PANEL_TITLE,
    PANEL_URL_PATH,
    PLATFORMS,
)

_LOGGER = logging.getLogger(__name__)
_FRONTEND_VERSION = "1.0.0"


async def async_setup_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Config-Entry einrichten: Frontend registrieren + Conversation-Plattform laden."""
    hass.data.setdefault(DOMAIN, {})
    await _async_register_frontend(hass, entry)
    await hass.config_entries.async_forward_entry_setups(entry, PLATFORMS)
    entry.async_on_unload(entry.add_update_listener(_async_update_listener))
    return True


async def async_unload_entry(hass: HomeAssistant, entry: ConfigEntry) -> bool:
    """Config-Entry entladen."""
    return await hass.config_entries.async_unload_platforms(entry, PLATFORMS)


async def _async_update_listener(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Bei Options-Änderung neu laden (übernimmt auch neue Panel-Optionen)."""
    await hass.config_entries.async_reload(entry)


async def _async_register_frontend(hass: HomeAssistant, entry: ConfigEntry) -> None:
    """Avatar-JS als statische Ressource bereitstellen und Sidebar-Panel anlegen."""
    store = hass.data[DOMAIN]

    # Statische JS-Datei + globale Ressource nur einmal registrieren.
    if not store.get("frontend_registered"):
        js_path = Path(__file__).parent / "www" / "avatar-panel.js"
        await hass.http.async_register_static_paths(
            [StaticPathConfig(FRONTEND_URL, str(js_path), False)]
        )
        frontend.add_extra_js_url(hass, f"{FRONTEND_URL}?v={_FRONTEND_VERSION}")
        store["frontend_registered"] = True

    # Panel mit aktuellen Optionen (neu) registrieren.
    panel_config = {
        "greeting": entry.options.get(CONF_GREETING, DEFAULT_GREETING),
        "wake_word": entry.options.get(CONF_WAKE_WORD, True),
        "pipeline_id": entry.options.get(CONF_PIPELINE_ID),
    }
    if store.get("panel_registered"):
        frontend.async_remove_panel(hass, PANEL_URL_PATH)
    await panel_custom.async_register_panel(
        hass,
        frontend_url_path=PANEL_URL_PATH,
        webcomponent_name="avatar-panel-app",
        module_url=f"{FRONTEND_URL}?v={_FRONTEND_VERSION}",
        sidebar_title=PANEL_TITLE,
        sidebar_icon=PANEL_ICON,
        require_admin=False,
        config={"options": panel_config},
        embed_iframe=False,
    )
    store["panel_registered"] = True
