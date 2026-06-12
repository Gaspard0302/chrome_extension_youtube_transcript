import React, { useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import type { ProviderId, Settings } from "../types";
import { PROVIDERS, DEFAULT_SETTINGS } from "../lib/providers";

// Short names for the chip row; full labels stay in providers.ts for the panel UI
const CHIP_LABELS: Record<ProviderId, string> = {
  anthropic: "Claude",
  openai: "OpenAI",
  google: "Gemini",
  groq: "Groq",
  mistral: "Mistral",
  ollama: "Ollama",
};

// Identify a provider from the shape of a pasted key. Order matters:
// "sk-ant-" must win over the generic OpenAI "sk-" prefix.
function detectProvider(raw: string): ProviderId | null {
  const k = raw.trim();
  if (k.length < 8) return null;
  if (k.startsWith("sk-ant-")) return "anthropic";
  if (k.startsWith("AIza")) return "google";
  if (k.startsWith("gsk_")) return "groq";
  if (k.startsWith("sk-") && !k.startsWith("sk-ant")) return "openai";
  return null; // Mistral keys have no distinctive prefix — pick the chip manually
}

const CSS = `
  :root { color-scheme: dark; }
  .ta-root {
    width: 340px;
    background: linear-gradient(180deg, #161616 0%, #0f0f0f 72px);
    color: #f1f1f1;
    font-family: 'Roboto', 'Arial', sans-serif;
    font-size: 13px;
    padding: 16px;
    box-sizing: border-box;
  }
  .ta-header { display: flex; align-items: center; gap: 9px; margin-bottom: 16px; }
  .ta-dot { width: 9px; height: 9px; border-radius: 50%; background: #ff0000; flex-shrink: 0; }
  .ta-wordmark { font-weight: 700; font-size: 15px; letter-spacing: -0.01em; }
  .ta-save-state {
    margin-left: auto; font-size: 11px; color: #2ba640;
    opacity: 0; transition: opacity 0.25s; display: flex; align-items: center; gap: 4px;
  }
  .ta-save-state.visible { opacity: 1; }

  .ta-label {
    font-size: 11px; font-weight: 600; color: #aaa;
    text-transform: uppercase; letter-spacing: 0.06em;
    margin: 0 0 8px;
  }

  .ta-chips { display: flex; flex-wrap: wrap; gap: 6px; margin-bottom: 14px; }
  .ta-chip {
    position: relative;
    border: none; cursor: pointer;
    background: rgba(255,255,255,0.08);
    color: #f1f1f1;
    border-radius: 8px;
    padding: 7px 12px;
    font-size: 12px; font-weight: 500;
    font-family: inherit;
    transition: background 0.15s, color 0.15s;
  }
  .ta-chip:hover { background: rgba(255,255,255,0.16); }
  .ta-chip.active { background: #f1f1f1; color: #0f0f0f; font-weight: 600; }
  .ta-chip .key-dot {
    display: inline-block; width: 5px; height: 5px; border-radius: 50%;
    background: #2ba640; margin-left: 6px; vertical-align: 1px;
  }
  .ta-chip.active .key-dot { background: #1a7a2e; }

  .ta-field { position: relative; margin-bottom: 6px; }
  .ta-input {
    width: 100%; box-sizing: border-box;
    background: #212121;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 10px;
    padding: 10px 38px 10px 12px;
    color: #f1f1f1;
    font-size: 12.5px;
    font-family: ui-monospace, 'SF Mono', Menlo, monospace;
    outline: none;
    transition: border-color 0.15s;
  }
  .ta-input::placeholder { font-family: 'Roboto', 'Arial', sans-serif; color: #717171; }
  .ta-input:focus { border-color: rgba(255,255,255,0.35); }
  .ta-eye {
    position: absolute; right: 6px; top: 50%; transform: translateY(-50%);
    background: none; border: none; cursor: pointer; padding: 4px;
    color: #aaa; display: flex; align-items: center;
    border-radius: 6px;
  }
  .ta-eye:hover { color: #f1f1f1; background: rgba(255,255,255,0.08); }

  .ta-hint { font-size: 11px; color: #717171; margin: 0 0 16px; min-height: 14px; }
  .ta-detected {
    display: inline-flex; align-items: center; gap: 4px;
    color: #2ba640; font-weight: 600;
    animation: ta-pop 0.2s ease-out;
  }
  @keyframes ta-pop {
    from { opacity: 0; transform: translateY(2px); }
    to { opacity: 1; transform: translateY(0); }
  }

  .ta-select-wrap { position: relative; margin-bottom: 18px; }
  .ta-select {
    width: 100%; box-sizing: border-box; appearance: none;
    background: #212121;
    border: 1px solid rgba(255,255,255,0.1);
    border-radius: 10px;
    padding: 10px 32px 10px 12px;
    color: #f1f1f1; font-size: 13px; font-family: inherit;
    cursor: pointer; outline: none;
    transition: border-color 0.15s;
  }
  .ta-select:focus { border-color: rgba(255,255,255,0.35); }
  .ta-select-wrap::after {
    content: ""; position: absolute; right: 13px; top: 50%;
    width: 7px; height: 7px; pointer-events: none;
    border-right: 1.5px solid #aaa; border-bottom: 1.5px solid #aaa;
    transform: translateY(-70%) rotate(45deg);
  }

  .ta-toggle-row {
    display: flex; align-items: flex-start; gap: 10px;
    padding: 12px; border-radius: 10px;
    background: rgba(255,255,255,0.04);
    cursor: pointer;
  }
  .ta-switch {
    position: relative; width: 34px; height: 20px; flex-shrink: 0;
    border-radius: 10px; background: rgba(255,255,255,0.2);
    transition: background 0.2s; margin-top: 1px;
  }
  .ta-switch.on { background: #ff0000; }
  .ta-switch::after {
    content: ""; position: absolute; top: 2px; left: 2px;
    width: 16px; height: 16px; border-radius: 50%; background: #fff;
    transition: transform 0.2s;
  }
  .ta-switch.on::after { transform: translateX(14px); }
  .ta-toggle-title { font-size: 13px; }
  .ta-toggle-sub { font-size: 11px; color: #717171; margin-top: 2px; }
`;

function SettingsApp() {
  const [settings, setSettings] = useState<Settings>(
    DEFAULT_SETTINGS as Settings
  );
  const [loaded, setLoaded] = useState(false);
  const [saveState, setSaveState] = useState<"idle" | "saved">("idle");
  const [revealKey, setRevealKey] = useState(false);
  const [detected, setDetected] = useState<ProviderId | null>(null);
  // Keys as last persisted — used to restore a provider's key when auto-detect
  // moves mid-typed input to a different provider's slot
  const baselineKeys = useRef<Settings["apiKeys"]>({});
  const saveTimer = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    chrome.runtime.sendMessage({ type: "GET_SETTINGS" }, (s) => {
      if (s) {
        const next = s as Settings;
        // Legacy state: no model picked yet but a key exists — preselect it
        if (next.selectedModel === "" && next.apiKeys) {
          const withKey = PROVIDERS.find((p) =>
            (next.apiKeys[p.id] ?? "").trim()
          );
          if (withKey) {
            next.selectedProvider = withKey.id;
            next.selectedModel = withKey.models[0].id;
          }
        }
        baselineKeys.current = { ...next.apiKeys };
        setSettings(next);
      }
      setLoaded(true);
    });
  }, []);

  // Auto-save: debounce every change after initial load
  useEffect(() => {
    if (!loaded) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(() => {
      chrome.runtime.sendMessage(
        { type: "SAVE_SETTINGS", payload: settings },
        () => {
          baselineKeys.current = { ...settings.apiKeys };
          setSaveState("saved");
          setTimeout(() => setSaveState("idle"), 1600);
        }
      );
    }, 450);
    return () => clearTimeout(saveTimer.current);
  }, [settings, loaded]);

  const activeProvider = PROVIDERS.find(
    (p) => p.id === settings.selectedProvider
  )!;
  const isOllama = settings.selectedProvider === "ollama";

  function selectProvider(id: ProviderId) {
    setDetected(null);
    setRevealKey(false);
    const p = PROVIDERS.find((pr) => pr.id === id)!;
    setSettings((prev) => ({
      ...prev,
      selectedProvider: id,
      selectedModel: p.models.some((m) => m.id === prev.selectedModel)
        ? prev.selectedModel
        : p.models[0].id,
    }));
  }

  function onKeyChange(value: string) {
    const hit = detectProvider(value);
    setDetected(hit);
    setSettings((prev) => {
      const active = prev.selectedProvider;
      if (hit && hit !== active) {
        // Pasted a key for a different provider: file it there, switch chips,
        // and restore whatever the current provider had saved before
        const apiKeys = { ...prev.apiKeys, [hit]: value };
        apiKeys[active] = baselineKeys.current[active] ?? "";
        const p = PROVIDERS.find((pr) => pr.id === hit)!;
        return {
          ...prev,
          apiKeys,
          selectedProvider: hit,
          selectedModel: p.models[0].id,
        };
      }
      return { ...prev, apiKeys: { ...prev.apiKeys, [active]: value } };
    });
  }

  const keyValue = settings.apiKeys[settings.selectedProvider] ?? "";

  return (
    <div className="ta-root">
      <style>{CSS}</style>

      <div className="ta-header">
        <div className="ta-dot" />
        <span className="ta-wordmark">TranscriptAI</span>
        <span className={`ta-save-state ${saveState === "saved" ? "visible" : ""}`}>
          ✓ Saved
        </span>
      </div>

      <p className="ta-label">Provider</p>
      <div className="ta-chips">
        {PROVIDERS.map((p) => (
          <button
            key={p.id}
            type="button"
            className={`ta-chip ${p.id === settings.selectedProvider ? "active" : ""}`}
            onClick={() => selectProvider(p.id)}
          >
            {CHIP_LABELS[p.id]}
            {p.requiresKey && (settings.apiKeys[p.id] ?? "").trim() && (
              <span className="key-dot" />
            )}
          </button>
        ))}
      </div>

      {isOllama ? (
        <>
          <div className="ta-field">
            <input
              className="ta-input"
              type="text"
              value={settings.ollamaBaseUrl}
              onChange={(e) =>
                setSettings((prev) => ({
                  ...prev,
                  ollamaBaseUrl: e.target.value,
                }))
              }
              placeholder="http://localhost:11434"
            />
          </div>
          <p className="ta-hint">Runs locally — no API key needed.</p>
        </>
      ) : (
        <>
          <div className="ta-field">
            <input
              className="ta-input"
              type={revealKey ? "text" : "password"}
              value={keyValue}
              onChange={(e) => onKeyChange(e.target.value)}
              placeholder="Paste any API key — provider auto-detects"
              spellCheck={false}
              autoComplete="off"
            />
            <button
              type="button"
              className="ta-eye"
              onClick={() => setRevealKey((v) => !v)}
              title={revealKey ? "Hide key" : "Show key"}
            >
              <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                {revealKey ? (
                  <>
                    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94" />
                    <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19" />
                    <line x1="1" y1="1" x2="23" y2="23" />
                  </>
                ) : (
                  <>
                    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
                    <circle cx="12" cy="12" r="3" />
                  </>
                )}
              </svg>
            </button>
          </div>
          <p className="ta-hint">
            {detected ? (
              <span className="ta-detected" key={detected}>
                ✓ {CHIP_LABELS[detected]} key detected
              </span>
            ) : keyValue ? (
              `Used for ${activeProvider.label}`
            ) : (
              "Stored locally, never leaves your browser."
            )}
          </p>
        </>
      )}

      <p className="ta-label">Model</p>
      <div className="ta-select-wrap">
        <select
          className="ta-select"
          value={settings.selectedModel}
          onChange={(e) =>
            setSettings((prev) => ({
              ...prev,
              selectedModel: e.target.value,
            }))
          }
        >
          {settings.selectedModel === "" && (
            <option value="" disabled>
              Choose a model…
            </option>
          )}
          {activeProvider.models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </select>
      </div>

      <div
        className="ta-toggle-row"
        onClick={() =>
          setSettings((prev) => ({
            ...prev,
            semanticSearchEnabled: !prev.semanticSearchEnabled,
          }))
        }
      >
        <div className={`ta-switch ${settings.semanticSearchEnabled ? "on" : ""}`} />
        <div>
          <div className="ta-toggle-title">Semantic search</div>
          <div className="ta-toggle-sub">
            Meaning-based transcript search. Downloads a 23&nbsp;MB model once.
          </div>
        </div>
      </div>
    </div>
  );
}

createRoot(document.getElementById("root")!).render(<SettingsApp />);
