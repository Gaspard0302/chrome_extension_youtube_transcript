/**
 * Runs in the page's MAIN world (see manifest content_scripts world: "MAIN").
 *
 * The isolated-world content script cannot touch the YouTube player's JS API,
 * so this bridge exposes two capabilities over DOM CustomEvents (strings only —
 * objects don't reliably cross the isolated/main world boundary):
 *
 *  - "ytta-get-pr" (detail: reqId) → "ytta-pr-result" (detail: JSON {reqId, pr})
 *    Returns #movie_player.getPlayerResponse() — ALWAYS current for the video
 *    being watched, unlike ytInitialPlayerResponse script tags which go stale
 *    after SPA navigation.
 *
 *  - "ytta-nudge-captions" (detail: JSON {lang})
 *    Briefly enables the player's caption module so the player itself issues a
 *    timedtext request with a valid Proof-of-Origin Token. The background
 *    worker captures that request via webRequest; the content script then
 *    re-fetches the captured URL. Captions are switched back off afterwards
 *    unless the user already had them on.
 */

type YTPlayer = HTMLElement & {
  getPlayerResponse?: () => unknown;
  loadModule?: (module: string) => void;
  unloadModule?: (module: string) => void;
  setOption?: (module: string, option: string, value: unknown) => void;
  getOption?: (module: string, option: string) => unknown;
};

function getPlayer(): YTPlayer | null {
  return document.getElementById("movie_player") as YTPlayer | null;
}

document.addEventListener("ytta-get-pr", (e) => {
  const reqId = String((e as CustomEvent).detail ?? "");
  let pr: unknown = null;
  try {
    pr = getPlayer()?.getPlayerResponse?.() ?? null;
  } catch {
    pr = null;
  }
  let json: string;
  try {
    json = JSON.stringify({ reqId, pr });
  } catch {
    json = JSON.stringify({ reqId, pr: null });
  }
  document.dispatchEvent(new CustomEvent("ytta-pr-result", { detail: json }));
});

document.addEventListener("ytta-nudge-captions", (e) => {
  try {
    const player = getPlayer();
    if (!player?.loadModule) return;

    let lang = "en";
    try {
      lang = JSON.parse(String((e as CustomEvent).detail ?? "{}"))?.lang ?? "en";
    } catch {
      // keep default
    }

    // Was a caption track already active? (getOption throws if the module
    // isn't loaded — that simply means captions are off.)
    let wasOn = false;
    try {
      const current = player.getOption?.("captions", "track");
      wasOn = !!current && Object.keys(current as object).length > 0;
    } catch {
      wasOn = false;
    }

    player.loadModule("captions");

    // Prefer the requested language, fall back to whatever track exists.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    let track: any = null;
    try {
      // eslint-disable-next-line @typescript-eslint/no-explicit-any
      const list = (player.getOption?.("captions", "tracklist") ?? []) as any[];
      track = list.find((t) => t?.languageCode === lang) ?? list[0] ?? null;
    } catch {
      track = null;
    }
    try {
      player.setOption?.("captions", "track", track ?? { languageCode: lang });
    } catch {
      // ignore — the loadModule alone often triggers the fetch
    }

    if (!wasOn) {
      setTimeout(() => {
        try {
          getPlayer()?.unloadModule?.("captions");
        } catch {
          // ignore
        }
      }, 2500);
    }
  } catch {
    // never let the bridge throw into the page
  }
});

export {};
