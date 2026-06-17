"""Konstanten für die AI-Avatar-Integration."""

from __future__ import annotations

from homeassistant.const import Platform

DOMAIN = "pq_avatar"
PLATFORMS = [Platform.CONVERSATION]

# Frontend
FRONTEND_URL = f"/{DOMAIN}/avatar-panel.js"
PANEL_URL_PATH = "ai-avatar"
PANEL_TITLE = "AI Avatar"
PANEL_ICON = "mdi:robot-happy"

# Provider
CONF_PROVIDER = "provider"
PROVIDER_NVIDIA = "nvidia"
PROVIDER_ANTHROPIC = "anthropic"
PROVIDER_OPENAI = "openai"
PROVIDERS = [PROVIDER_NVIDIA, PROVIDER_ANTHROPIC, PROVIDER_OPENAI]

# Config-/Options-Keys
CONF_BASE_URL = "base_url"
CONF_MODEL = "model"
CONF_MAX_TOKENS = "max_tokens"
CONF_TEMPERATURE = "temperature"
CONF_SYSTEM_PROMPT = "system_prompt"
CONF_GREETING = "greeting"
CONF_WAKE_WORD = "wake_word"
CONF_PIPELINE_ID = "pipeline_id"

# Defaults je Provider
DEFAULT_BASE_URLS = {
    PROVIDER_NVIDIA: "https://integrate.api.nvidia.com/v1",
    PROVIDER_OPENAI: "https://api.openai.com/v1",
    PROVIDER_ANTHROPIC: "https://api.anthropic.com",
}
DEFAULT_MODELS = {
    PROVIDER_NVIDIA: "meta/llama-3.3-70b-instruct",
    PROVIDER_ANTHROPIC: "claude-opus-4-8",
    PROVIDER_OPENAI: "gpt-4o-mini",
}
# Exakte Anthropic-Model-IDs (Stand claude-api-Skill): Opus 4.8 / Sonnet 4.6 / Haiku 4.5
ANTHROPIC_MODELS = ["claude-opus-4-8", "claude-sonnet-4-6", "claude-haiku-4-5"]

DEFAULT_MAX_TOKENS = 1024
DEFAULT_TEMPERATURE = 0.7
DEFAULT_SYSTEM_PROMPT = (
    "Du bist ein hilfreicher Sprachassistent in einem Smart Home. "
    "Antworte kurz, freundlich und natürlich — deine Antwort wird vorgelesen. "
    "Keine Aufzählungen oder Markdown, formuliere in ganzen Sätzen."
)
DEFAULT_GREETING = "Sag „Ok Nabu“"
HISTORY_TURNS = 20
