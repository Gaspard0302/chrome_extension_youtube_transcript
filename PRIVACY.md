# Privacy Policy — TranscriptAI for YouTube

**Last updated: June 13, 2026**

TranscriptAI for YouTube ("the extension") is a browser extension that adds
transcript search, AI chat, and chapter generation to YouTube videos. This
policy explains what data the extension handles and where it goes.

## Summary

- The extension developer operates **no servers** and **collects no data**.
- Your API key and preferences are stored **only in your own browser**.
- Transcript and chat content is sent **only** to the AI provider **you**
  choose, authenticated with **your own** API key.
- Nothing is sold, shared, or transferred to any other party.

## What data is handled

**Authentication information (your API key).**
To use AI features you provide your own API key for a supported provider
(Anthropic, OpenAI, Google, Mistral, or Groq) or run a local model via Ollama.
This key is stored using the browser's `storage` API on your device. It is sent
only to the corresponding provider's official API endpoint to authenticate your
own requests. It is never transmitted to the developer or to any third party.

**Website content (transcript and chat text).**
To answer your questions and power search, the extension reads the transcript of
the YouTube video you are currently viewing. When you use the AI chat or search
features, the relevant transcript text and the message you type are sent to the
AI provider you selected, using your own API key, solely to generate a response.
If you use a local model via Ollama, this content never leaves your machine.

**Preferences.**
Your selected provider, model, and settings are stored locally on your device
via the browser's `storage` API.

## What the extension does NOT do

- It does not collect, log, or transmit any data to the developer.
- It does not use analytics, tracking, or telemetry of any kind.
- It does not sell or transfer user data to third parties.
- It does not use data for creditworthiness or lending.
- It does not access data on websites other than YouTube.

## Third-party AI providers

When you use AI features, your requests are governed by the privacy policy of
the provider you choose:

- Anthropic — https://www.anthropic.com/legal/privacy
- OpenAI — https://openai.com/policies/privacy-policy
- Google (Gemini) — https://policies.google.com/privacy
- Mistral — https://mistral.ai/terms/#privacy-policy
- Groq — https://groq.com/privacy-policy/

The developer has no access to and no control over data once it is sent to your
chosen provider. Using a local Ollama model keeps all content on your device.

## Permissions

- **storage** — save your API key and preferences locally.
- **offscreen** — run the on-device semantic-search model in the browser.
- **webRequest** — observe YouTube caption-track URLs (on youtube.com only) to
  fetch the current video's transcript; requests are never modified.
- **Host access** — youtube.com (read transcript, show the UI) and the AI
  provider API hosts (fulfill your own requests with your own key).

## Changes

This policy may be updated as the extension evolves. Material changes will be
reflected in this document with an updated date.

## Contact

Questions about this policy: aifactory@hubvisory.com
