# AI Avatar – Home-Assistant-Integration

Installierbare Home-Assistant-**Integration** mit eigener Einstellungs-Oberfläche: ein
**Conversation-Agent**, der wahlweise an **NVIDIA NIM** oder **Anthropic (Claude)** angebunden ist,
**plus** ein gebündelter, animierter **AI-Avatar** als Vollbild-„App" (Sidebar-Eintrag) fürs Tablet.

Damit lässt sich auch das übliche Problem lösen, dass NVIDIA nicht in der Pipeline-Agent-Auswahl
auftaucht (die eingebaute „OpenAI Conversation"-Integration nutzt die OpenAI-*Responses*-API, die
NVIDIA NIM nicht unterstützt). Diese Integration registriert ihren **eigenen** Agent über die
**Chat-Completions**-API → er ist direkt in der Assist-Pipeline wählbar.

---

## Was die Integration mitbringt

- **Conversation-Agent „AI Avatar"** – erscheint unter *Einstellungen → Sprachassistenten* als
  wählbarer Agent.
- **Multi-Provider** (per Dropdown im Konfig-Dialog):
  - **NVIDIA NIM** / beliebige OpenAI-kompatible Endpunkte (offizielles `openai`-SDK, Chat-Completions)
  - **Anthropic / Claude** (offizielles `anthropic`-SDK, Messages API)
- **Einstellungs-UI** (Konfig + Optionen): API-Key, Base-URL, Modell, Max-Tokens, Temperatur
  (nur OpenAI/NVIDIA), System-Prompt, Begrüßung, Wake Word, Pipeline.
- **Avatar-Frontend** wird automatisch registriert: eigener **Sidebar-Eintrag „AI Avatar"**
  (Vollbild) und die Lovelace-Karte `custom:avatar-panel-card` ohne manuelles Resource-Setup.

API-Keys liegen **ausschließlich in Home Assistant** (Config-Entry) – nie im Browser/Tablet.

---

## Installation (HACS)

1. HACS → **Integrationen** → ⋮ → *Benutzerdefinierte Repositories* → URL
   `https://github.com/pquandel2-alt/pq_avatar`, Kategorie **Integration** → hinzufügen.
2. „AI Avatar" installieren, **Home Assistant neu starten**.

**Manuell:** Ordner `custom_components/pq_avatar/` nach `<config>/custom_components/` kopieren,
Home Assistant neu starten.

---

## Einrichtung

### 1. Integration hinzufügen
*Einstellungen → Geräte & Dienste → Integration hinzufügen → „AI Avatar"*.

1. **Anbieter wählen:** NVIDIA NIM, Anthropic (Claude) oder OpenAI-kompatibel.
2. **Zugangsdaten:**

   | Anbieter        | Felder                                                                 |
   |-----------------|------------------------------------------------------------------------|
   | NVIDIA NIM      | API-Key ([build.nvidia.com](https://build.nvidia.com)), Base-URL `https://integrate.api.nvidia.com/v1`, Modell z. B. `meta/llama-3.3-70b-instruct` |
   | Anthropic       | API-Key, Modell `claude-opus-4-8` (oder `claude-sonnet-4-6` / `claude-haiku-4-5`) |
   | OpenAI-kompat.  | API-Key, Base-URL, Modell                                              |

   Der Schlüssel wird beim Speichern mit einem Test-Call geprüft.

### 2. STT / TTS / Wake Word (HA-Standard)
Add-ons **Whisper** (STT), **Piper** (TTS) und **openWakeWord** installieren – oder HA Cloud.

### 3. Pipeline verknüpfen
*Einstellungen → Sprachassistenten →* Pipeline anlegen/bearbeiten:
- **Conversation agent:** „AI Avatar"
- **Speech-to-text:** Whisper · **Text-to-speech:** Piper · **Wake word:** openWakeWord

Im Assist-Chat testen → der gewählte Provider antwortet.

### 4. Avatar aufs Tablet
Nach der Installation gibt es den Sidebar-Eintrag **„AI Avatar"** (Vollbild-Avatar). Auf dem
Tablet (Fully Kiosk) diese Ansicht als Startseite setzen.

---

## Optionen (Einstellungen → AI Avatar → Konfigurieren)

| Option          | Beschreibung                                                            |
|-----------------|------------------------------------------------------------------------|
| `model`         | Modell-ID (Anthropic als Dropdown mit Freitext)                        |
| `max_tokens`    | max. Antwortlänge (Default 1024)                                       |
| `temperature`   | nur OpenAI/NVIDIA (Claude lehnt den Parameter ab)                      |
| `system_prompt` | Persönlichkeit/Verhalten; Default ist auf kurze Voice-Antworten getrimmt |
| `greeting`      | Text im Start-Overlay des Avatars                                     |
| `wake_word`     | Wake Word im Browser nutzen (sonst Tippen startet)                    |
| `pipeline_id`   | feste Pipeline für den Avatar (optional)                              |

---

## Fully Kiosk Browser (Tablet)

- **HTTPS Pflicht** (sonst kein Mikrofon). `internal_url` korrekt setzen.
- Fully Kiosk PLUS: **„Enable Microphone Access"** + Web-Mic-Berechtigung.
- **Autoplay** für Audio erlauben (sonst stummes TTS).
- **Screensaver** statt „Screen off" (Display dimmen, Mikro bleibt aktiv).

---

## Avatar-Zustände

`idle → listening → thinking → speaking → idle`, gesteuert über die Assist-Pipeline-Events; der
Mund folgt amplitudenbasiert dem TTS-Audio (Lippensync). Das Frontend basiert auf
[`pq_avatar_panel`](https://github.com/pquandel2-alt/pq_avatar_panel).

---

## Grenzen / Hinweise

- **Gerätesteuerung per LLM** (Lichter schalten o. ä.) ist noch nicht enthalten – aktuell reine
  Konversation. Ausbaustufe: HA-LLM-Tools/Function-Calling.
- **NVIDIA Free Tier:** 40 Anfragen/Min.
- **Claude-Modelle:** Opus/Sonnet 4.x akzeptieren kein `temperature`/`budget_tokens`; die
  Integration sendet diese für den Anthropic-Pfad daher bewusst nicht.
- Mindestens Home Assistant **2024.11**.
