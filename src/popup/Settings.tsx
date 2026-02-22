import React, { useEffect, useState } from "react";
import { createRoot } from "react-dom/client";
import type { Settings } from "../types";
import { PROVIDERS, DEFAULT_SETTINGS } from "../lib/providers";
import "../content/content.css";

function SettingsApp() {
  const [settings, setSettings] = useState<Settings>(DEFAULT_SETTINGS as Settings);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    chrome.runtime.sendMessage({ type: "GET_SETTINGS" }, (s) => {
      if (s) setSettings(s as Settings);
    });
  }, []);

  function save() {
    chrome.runtime.sendMessage({ type: "SAVE_SETTINGS", payload: settings }, () => {
      setSaved(true);
      setTimeout(() => setSaved(false), 2000);
    });
  }

  function setKey(provider: string, key: string) {
    setSettings((prev) => ({
      ...prev,
      apiKeys: { ...prev.apiKeys, [provider]: key },
    }));
  }

  const style = {
    container: {
      width: 340,
      padding: "16px",
      background: "#0F0F0F",
      color: "#F1F1F1",
      fontFamily: "'Roboto', 'Arial', sans-serif",
      fontSize: 13,
    } as React.CSSProperties,
    label: {
      display: "block",
      fontSize: 11,
      color: "#AAAAAA",
      marginBottom: 4,
      fontWeight: 600,
      textTransform: "uppercase" as const,
      letterSpacing: "0.5px",
    },
    input: {
      width: "100%",
      background: "#212121",
      border: "1px solid #3F3F3F",
      borderRadius: 6,
      padding: "8px 10px",
      color: "#F1F1F1",
      fontSize: 12,
      outline: "none",
      boxSizing: "border-box" as const,
      fontFamily: "monospace",
    },
    section: {
      marginBottom: 16,
      paddingBottom: 16,
      borderBottom: "1px solid #1F1F1F",
    },
    sectionTitle: {
      fontSize: 12,
      fontWeight: 700,
      color: "#FF0000",
      marginBottom: 10,
      display: "flex",
      alignItems: "center",
      gap: 6,
    } as React.CSSProperties,
  };

  return (
    <div style={style.container}>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 16 }}>
        <div style={{ width: 8, height: 8, borderRadius: "50%", background: "#FF0000" }} />
        <span style={{ fontWeight: 700, fontSize: 15 }}>Transcript Search</span>
      </div>

      {/* API Keys */}
      <div style={style.section}>
        <div style={style.sectionTitle}>API Keys</div>
        {PROVIDERS.filter((p) => p.requiresKey).map((p) => (
          <div key={p.id} style={{ marginBottom: 10 }}>
            <label style={style.label}>{p.label}</label>
            <input
              type="password"
              value={settings.apiKeys[p.id] ?? ""}
              onChange={(e) => setKey(p.id, e.target.value)}
              placeholder={`${p.label} API key…`}
              style={style.input}
            />
          </div>
        ))}
      </div>

      {/* Ollama */}
      <div style={style.section}>
        <div style={style.sectionTitle}>Ollama (local models)</div>
        <label style={style.label}>Base URL</label>
        <input
          type="text"
          value={settings.ollamaBaseUrl}
          onChange={(e) =>
            setSettings((prev) => ({ ...prev, ollamaBaseUrl: e.target.value }))
          }
          placeholder="http://localhost:11434"
          style={style.input}
        />
      </div>

      {/* Default provider */}
      <div style={style.section}>
        <div style={style.sectionTitle}>Defaults</div>
        <label style={style.label}>Default provider</label>
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
          style={{ ...style.input, fontFamily: "inherit" }}
        >
          {PROVIDERS.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}
            </option>
          ))}
        </select>
        <div style={{ height: 8 }} />
        <label style={style.label}>Default model</label>
        <select
          value={settings.selectedModel}
          onChange={(e) =>
            setSettings((prev) => ({ ...prev, selectedModel: e.target.value }))
          }
          style={{ ...style.input, fontFamily: "inherit" }}
        >
          {(
            PROVIDERS.find((p) => p.id === settings.selectedProvider)?.models ??
            []
          ).map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
        <div style={{ height: 10 }} />
        <label
          style={{ display: "flex", alignItems: "center", gap: 8, cursor: "pointer" }}
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
            style={{ accentColor: "#FF0000" }}
          />
          <span style={{ fontSize: 12, color: "#F1F1F1" }}>
            Enable semantic (AI) search
          </span>
          <span style={{ fontSize: 10, color: "#AAAAAA" }}>
            (downloads 23MB model once)
          </span>
        </label>
      </div>

      {/* Save */}
      <button
        onClick={save}
        style={{
          width: "100%",
          padding: "10px",
          background: saved ? "#166534" : "#CC0000",
          border: "none",
          borderRadius: 8,
          color: "white",
          fontSize: 13,
          fontWeight: 700,
          cursor: "pointer",
          transition: "background 0.2s",
        }}
      >
        {saved ? "Saved!" : "Save Settings"}
      </button>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<SettingsApp />);
