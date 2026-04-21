export function createDomRefs(documentRef) {
  return {
    body: documentRef.body,
    rootElement: documentRef.documentElement,
    form: documentRef.getElementById("profiles-form"),
    profilesList: documentRef.getElementById("profiles-list"),
    addProfileButton: documentRef.getElementById("add-profile-button"),
    submitButton: documentRef.getElementById("submit-button"),
    statusPanel: documentRef.getElementById("status-panel"),
    statusTitle: documentRef.getElementById("status-title"),
    statusText: documentRef.getElementById("status-text"),
    emptyState: documentRef.getElementById("empty-state"),
    seedCountElement: documentRef.getElementById("seed-count"),
    nodeCountElement: documentRef.getElementById("node-count"),
    sharedCountElement: documentRef.getElementById("shared-count"),
    seedProfilesList: documentRef.getElementById("seed-profiles-list"),
    overlapsList: documentRef.getElementById("overlaps-list"),
    tooltip: documentRef.getElementById("graph-tooltip"),
    canvas: documentRef.getElementById("graph-canvas"),
    graphStage: documentRef.getElementById("graph-stage"),
    focusState: documentRef.getElementById("focus-state"),
    fullscreenButton: documentRef.getElementById("fullscreen-button"),
    themeToggleButton: documentRef.getElementById("theme-toggle-button"),
    highlightAllButton: documentRef.getElementById("highlight-all-button"),
    zoomLevel: documentRef.getElementById("zoom-level"),
    resetViewButton: documentRef.getElementById("reset-view-button"),
  };
}

export function readPageConfig(body) {
  return {
    maxProfiles: Number(body.dataset.maxProfiles || 5),
    pollIntervalMs: Number(body.dataset.pollIntervalMs || 1500),
  };
}
