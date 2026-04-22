export function createDomRefs(documentRef) {
  return {
    body: documentRef.body,
    form: documentRef.getElementById("deep-analysis-form"),
    profileInput: documentRef.getElementById("deep-analysis-profile-input"),
    depthInput: documentRef.getElementById("deep-analysis-depth-input"),
    submitButton: documentRef.getElementById("deep-analysis-submit-button"),
    statusPanel: documentRef.getElementById("deep-analysis-status-panel"),
    statusTitle: documentRef.getElementById("deep-analysis-status-title"),
    statusText: documentRef.getElementById("deep-analysis-status-text"),
    emptyState: documentRef.getElementById("deep-analysis-empty-state"),
    requestedDepthMetric: documentRef.getElementById("deep-analysis-requested-depth"),
    cycleCountMetric: documentRef.getElementById("deep-analysis-cycle-count"),
    renderedNodeCountMetric: documentRef.getElementById("deep-analysis-rendered-node-count"),
    rootProfileContainer: documentRef.getElementById("deep-analysis-root-profile"),
    cyclesList: documentRef.getElementById("deep-analysis-cycles-list"),
    cyclesSectionBody: documentRef.getElementById("deep-analysis-cycles-section-body"),
    cyclesToggleButton: documentRef.getElementById("deep-analysis-cycles-toggle-button"),
    tooltip: documentRef.getElementById("deep-analysis-graph-tooltip"),
    canvas: documentRef.getElementById("deep-analysis-graph-canvas"),
    graphStage: documentRef.getElementById("deep-analysis-graph-stage"),
    focusState: documentRef.getElementById("deep-analysis-focus-state"),
    fullscreenButton: documentRef.getElementById("deep-analysis-fullscreen-button"),
    highlightCyclesButton: documentRef.getElementById("deep-analysis-highlight-cycles-button"),
    directFriendsButton: documentRef.getElementById("deep-analysis-direct-friends-button"),
    zoomLevel: documentRef.getElementById("deep-analysis-zoom-level"),
    resetViewButton: documentRef.getElementById("deep-analysis-reset-view-button"),
  };
}

export function readPageConfig(body) {
  return {
    maxDepth: Number(body.dataset.maxDepth || 6),
    pollIntervalMs: Number(body.dataset.pollIntervalMs || 1500),
  };
}
