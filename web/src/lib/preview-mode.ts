export const PREVIEW_MODE_KEY = "karmancos-id-preview";

export function isPreviewMode(): boolean {
  if (!import.meta.env.DEV || typeof window === "undefined") return false;
  if (new URLSearchParams(window.location.search).get("preview") === "1") return true;
  try {
    return window.sessionStorage.getItem(PREVIEW_MODE_KEY) === "1";
  } catch {
    return false;
  }
}

export function leavePreviewMode(): void {
  if (typeof window === "undefined") return;
  try {
    window.sessionStorage.removeItem(PREVIEW_MODE_KEY);
  } catch {
    // Preview stays local to this tab; the safe route below still exits it.
  }
  window.location.assign("/");
}
