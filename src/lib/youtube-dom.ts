export type PanelMode = "secondary" | "description";

/**
 * Find the action bar container where YouTube renders Share/Download/Clip buttons.
 * Tries multiple selectors in order of preference for resilience against YouTube DOM changes.
 */
export function findActionBar(): Element | null {
  return (
    document.querySelector("#top-level-buttons-computed") ??
    document.querySelector("ytd-watch-metadata #top-level-buttons") ??
    document.querySelector("#actions #top-level-buttons") ??
    document.querySelector("#actions-inner") ??
    null
  );
}

/**
 * Find YouTube's secondary column (recommended videos sidebar).
 */
export function findSecondaryColumn(): Element | null {
  return (
    document.querySelector("#secondary-inner") ??
    document.querySelector("#secondary") ??
    null
  );
}

/**
 * Find the video description container as a fallback injection point
 * (used in theater mode or when the secondary column is hidden).
 */
export function findDescriptionContainer(): Element | null {
  return (
    document.querySelector("#description-inner") ??
    document.querySelector("#description") ??
    null
  );
}

/**
 * Watch for both the action bar and a panel insertion point to become available.
 * Calls onReady once when both exist, then disconnects the observer.
 * Returns the MutationObserver so the caller can disconnect it early if needed.
 */
export function waitForDOMNodes(
  onReady: (
    actionBar: Element,
    panelNode: Element,
    panelMode: PanelMode
  ) => void
): MutationObserver {
  function check(): boolean {
    const actionBar = findActionBar();
    const secondary = findSecondaryColumn();
    const description = findDescriptionContainer();
    const panelNode = secondary ?? description;
    const mode: PanelMode = secondary ? "secondary" : "description";

    if (actionBar && panelNode) {
      onReady(actionBar, panelNode, mode);
      return true;
    }
    return false;
  }

  if (check()) {
    return new MutationObserver(() => {});
  }

  const observer = new MutationObserver(() => {
    if (check()) observer.disconnect();
  });
  observer.observe(document.body, { childList: true, subtree: true });
  return observer;
}
