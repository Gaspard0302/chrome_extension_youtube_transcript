import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Settings } from "../types";
import { PROVIDERS, DEFAULT_SETTINGS } from "../lib/providers";

// Popup runs in extension context; use same fallback palette as content script for consistent look
// Match content panel: 12px cards, 18px chips
const popupVars = {
  bg: "#0f0f0f",
  bgCard: "#212121",
  border: "rgba(255,255,255,0.1)",
  text: "#f1f1f1",
  textSecondary: "#aaa",
  accent: "#ff0000",
  accentSuccess: "#166534",
  radius: 12,
  radiusChip: 18,
};

function SettingsApp() {
  const [settings, setSettings] = useState<Settings>(
    DEFAULT_SETTINGS as Settings
  );
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: "GET_SETTINGS" }, (s) => {
      if (!s) return;
      const loaded = s as Settings;
      if (loaded.selectedModel === "" && loaded.apiKeys && typeof loaded.apiKeys === "object") {
        const firstWithKey = PROVIDERS.find(
          (p) => loaded.apiKeys[p.id] && String(loaded.apiKeys[p.id]).trim().length > 0
        );
        if (firstWithKey) {
          setSettings({
            ...loaded,
            selectedProvider: firstWithKey.id,
            selectedModel: firstWithKey.models[0].id,
          });
          return;
        }
      }
      setSettings(loaded);
    });
  }, []);

  function save() {
    chrome.runtime.sendMessage(
      { type: "SAVE_SETTINGS", payload: settings },
      () => {
        setSaved(true);
        setTimeout(() => setSaved(false), 2000);
      }
    );
  }

  function setKey(provider: string, key: string) {
    setSettings((prev) => {
      const next = { ...prev, apiKeys: { ...prev.apiKeys, [provider]: key } };
      if (key.trim().length > 0 && prev.selectedModel === "") {
        const p = PROVIDERS.find((pr) => pr.id === provider);
        if (p) {
          next.selectedProvider = p.id;
          next.selectedModel = p.models[0].id;
        }
      }
      return next;
    });
  }

  return (
    <div
      style={{
        width: 360,
        minHeight: 320,
        padding: "20px 16px",
        background: popupVars.bg,
        color: popupVars.text,
        fontFamily: "'Roboto', 'Arial', sans-serif",
        fontSize: 13,
        boxSizing: "border-box",
        border: `1px solid ${popupVars.border}`,
        borderRadius: popupVars.radius,
      }}
    >
      {/* Header */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 10,
          marginBottom: 20,
        }}
      >
        <div
          style={{
            width: 10,
            height: 10,
            borderRadius: "50%",
            background: popupVars.accent,
            flexShrink: 0,
          }}
        />
        <span style={{ fontWeight: 700, fontSize: 16 }}>TranscriptAI</span>
      </div>

      {/* API Keys — chip-style section */}
      <section
        style={{
          marginBottom: 20,
          paddingBottom: 16,
          borderBottom: `1px solid ${popupVars.border}`,
        }}
      >
        <h2
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: popupVars.text,
            margin: "0 0 12px",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          API Keys
        </h2>
        {PROVIDERS.filter((p) => p.requiresKey).map((p) => (
          <div key={p.id} style={{ marginBottom: 10 }}>
            <label
              style={{
                display: "block",
                fontSize: 11,
                color: popupVars.textSecondary,
                marginBottom: 4,
                fontWeight: 600,
              }}
            >
              {p.label}
            </label>
            <input
              type="password"
              value={settings.apiKeys[p.id] ?? ""}
              onChange={(e) => setKey(p.id, e.target.value)}
              placeholder={`${p.label} API key…`}
              style={{
                width: "100%",
                background: popupVars.bgCard,
                border: `1px solid ${popupVars.border}`,
                borderRadius: popupVars.radiusChip,
                padding: "10px 14px",
                color: popupVars.text,
                fontSize: 13,
                outline: "none",
                boxSizing: "border-box",
                fontFamily: "inherit",
              }}
            />
          </div>
        ))}
      </section>

      {/* Ollama */}
      <section
        style={{
          marginBottom: 20,
          paddingBottom: 16,
          borderBottom: `1px solid ${popupVars.border}`,
        }}
      >
        <h2
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: popupVars.text,
            margin: "0 0 12px",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          Ollama (local)
        </h2>
        <label
          style={{
            display: "block",
            fontSize: 11,
            color: popupVars.textSecondary,
            marginBottom: 4,
            fontWeight: 600,
          }}
        >
          Base URL
        </label>
        <input
          type="text"
          value={settings.ollamaBaseUrl}
          onChange={(e) =>
            setSettings((prev) => ({ ...prev, ollamaBaseUrl: e.target.value }))
          }
          placeholder="http://localhost:11434"
          style={{
            width: "100%",
            background: popupVars.bgCard,
            border: `1px solid ${popupVars.border}`,
            borderRadius: popupVars.radiusChip,
            padding: "10px 14px",
            color: popupVars.text,
            fontSize: 13,
            outline: "none",
            boxSizing: "border-box",
            fontFamily: "inherit",
          }}
        />
      </section>

      {/* Model selection */}
      <section
        style={{
          marginBottom: 20,
          paddingBottom: 16,
          borderBottom: `1px solid ${popupVars.border}`,
        }}
      >
        <h2
          style={{
            fontSize: 12,
            fontWeight: 700,
            color: popupVars.text,
            margin: "0 0 12px",
            textTransform: "uppercase",
            letterSpacing: "0.05em",
          }}
        >
          AI Model
        </h2>
        <label
          style={{
            display: "block",
            fontSize: 11,
            color: popupVars.textSecondary,
            marginBottom: 4,
            fontWeight: 600,
          }}
        >
          Provider
        </label>
        <select
          value={settings.selectedProvider}
          onChange={(e) => {
            const p = PROVIDERS.find((pr) => pr.id === e.target.value)!;
            setSettings((prev) => ({
              ...prev,
              selectedProvider: p.id,
              selectedModel: p.models[0].id,
            }));
          }}
          style={{
            width: "100%",
            background: popupVars.bgCard,
            border: `1px solid ${popupVars.border}`,
            borderRadius: popupVars.radiusChip,
            padding: "10px 14px",
            color: popupVars.text,
            fontSize: 13,
            marginBottom: 12,
            cursor: "pointer",
            outline: "none",
            fontFamily: "inherit",
            boxSizing: "border-box",
          }}
        >
          {PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <label
          style={{
            display: "block",
            fontSize: 11,
            color: popupVars.textSecondary,
            marginBottom: 4,
            fontWeight: 600,
          }}
        >
          Model
        </label>
        <select
          value={settings.selectedModel}
          onChange={(e) =>
            setSettings((prev) => ({ ...prev, selectedModel: e.target.value }))
          }
          style={{
            width: "100%",
            background: popupVars.bgCard,
            border: `1px solid ${popupVars.border}`,
            borderRadius: popupVars.radiusChip,
            padding: "10px 14px",
            color: popupVars.text,
            fontSize: 13,
            cursor: "pointer",
            outline: "none",
            fontFamily: "inherit",
            boxSizing: "border-box",
          }}
        >
          {(PROVIDERS.find((p) => p.id === settings.selectedProvider)?.models ?? []).map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </section>

      {/* Semantic search toggle */}
      <section style={{ marginBottom: 20 }}>
        <label
          style={{
            display: "flex",
            alignItems: "center",
            gap: 10,
            cursor: "pointer",
          }}
        >
          <input
            type="checkbox"
            checked={settings.semanticSearchEnabled}
            onChange={(e) =>
              setSettings((prev) => ({
                ...prev,
                semanticSearchEnabled: e.target.checked,
              }))
            }
            style={{ accentColor: popupVars.accent }}
          />
          <span style={{ fontSize: 13, color: popupVars.text }}>
            Enable semantic (AI) search in transcript
          </span>
        </label>
        <p
          style={{
            margin: "4px 0 0 28px",
            fontSize: 11,
            color: popupVars.textSecondary,
          }}
        >
          Downloads a 23MB model once for meaning-based search.
        </p>
      </section>

      {/* Save button — chip-style */}
      <button
        type="button"
        onClick={save}
        style={{
          width: "100%",
          padding: "12px 16px",
          background: saved ? popupVars.accentSuccess : popupVars.accent,
          border: "none",
          borderRadius: popupVars.radius,
          color: "#fff",
          fontSize: 14,
          fontWeight: 700,
          cursor: "pointer",
          transition: "background 0.2s",
          fontFamily: "inherit",
        }}
      >
        {saved ? "Saved!" : "Save settings"}
      </button>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<SettingsApp />);
