window.addEventListener("DOMContentLoaded", function () {
  const DEFAULT_AVATAR_BUCKETS = [12, 16, 20, 24, 32, 40, 52];
  const ALL_SHARED_FOCUS_KEY = "shared:all";
  const body = document.body;
  const maxProfiles = Number(body.dataset.maxProfiles || 5);
  const pollIntervalMs = Number(body.dataset.pollIntervalMs || 1500);

  const form = document.getElementById("profiles-form");
  const profilesList = document.getElementById("profiles-list");
  const addProfileButton = document.getElementById("add-profile-button");
  const submitButton = document.getElementById("submit-button");
  const statusPanel = document.getElementById("status-panel");
  const statusTitle = document.getElementById("status-title");
  const statusText = document.getElementById("status-text");
  const emptyState = document.getElementById("empty-state");
  const seedCountElement = document.getElementById("seed-count");
  const nodeCountElement = document.getElementById("node-count");
  const sharedCountElement = document.getElementById("shared-count");
  const seedProfilesList = document.getElementById("seed-profiles-list");
  const overlapsList = document.getElementById("overlaps-list");
  const tooltip = document.getElementById("graph-tooltip");
  const canvas = document.getElementById("graph-canvas");
  const focusState = document.getElementById("focus-state");
  const highlightAllButton = document.getElementById("highlight-all-button");
  const zoomLevel = document.getElementById("zoom-level");
  const resetViewButton = document.getElementById("reset-view-button");

  const renderer = new GraphRenderer(canvas, tooltip);
  const state = {
    pollHandle: null,
    latestJobId: null,
    result: null,
    intersectionGroups: [],
    focusKey: null,
    focusLabel: null,
  };

  renderer.setViewportListener(updateViewportUi);
  boot();

  function boot() {
    addProfileRow("https://vk.com/durov");
    addProfileRow("");

    addProfileButton.addEventListener("click", () => {
      if (profilesList.children.length >= maxProfiles) {
        setStatus("Лимит достигнут", `Можно добавить не больше ${maxProfiles} профилей.`, "error");
        return;
      }
      addProfileRow("");
      updateProfileControls();
    });

    highlightAllButton.addEventListener("click", toggleAllSharedFocus);
    resetViewButton.addEventListener("click", () => renderer.resetView());
    form.addEventListener("submit", onSubmit);
    window.addEventListener("resize", () => renderer.handleResize());
    updateProfileControls();
    updateFocusUi();
  }

  function addProfileRow(value) {
    const row = document.createElement("div");
    row.className = "profile-row";

    const index = document.createElement("span");
    index.className = "profile-index";

    const input = document.createElement("input");
    input.className = "profile-input";
    input.type = "text";
    input.placeholder = "https://vk.com/durov или screen_name";
    input.value = value;

    const removeButton = document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "icon-button";
    removeButton.textContent = "×";
    removeButton.title = "Удалить профиль";
    removeButton.addEventListener("click", () => {
      row.remove();
      updateProfileControls();
    });

    row.append(index, input, removeButton);
    profilesList.appendChild(row);
    updateProfileControls();
  }

  function updateProfileControls() {
    [...profilesList.children].forEach((row, idx) => {
      row.querySelector(".profile-index").textContent = String(idx + 1);
      row.querySelector(".icon-button").disabled = profilesList.children.length <= 1;
    });
    addProfileButton.disabled = profilesList.children.length >= maxProfiles;
  }

  async function onSubmit(event) {
    event.preventDefault();

    const profiles = [...profilesList.querySelectorAll(".profile-input")]
      .map((input) => input.value.trim())
      .filter(Boolean);

    if (!profiles.length) {
      setStatus("Нет профилей", "Добавьте хотя бы один профиль VK.", "error");
      return;
    }

    if (new Set(profiles).size !== profiles.length) {
      setStatus("Дубликаты профилей", "Повторяющиеся профили лучше убрать ещё на фронтенде.", "error");
      return;
    }

    stopPolling();
    clearGraph();
    setLoadingState(true);
    setStatus("Запускаю задачу", "Frontend отправляет выбранные профили в backend и ждёт job id.", "loading");

    try {
      const response = await fetch("/api/social-graphs/jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ profiles }),
      });
      const payload = await response.json();
      if (!response.ok) {
        throw new Error(payload.detail || "Не удалось запустить задачу.");
      }

      state.latestJobId = payload.job_id;
      setStatus(
        "Задача запущена",
        `Job ${payload.job_id.slice(0, 8)}... создан. Жду готовый social graph из backend.`,
        "loading",
      );
      pollJob(payload.status_url);
    } catch (error) {
      setLoadingState(false);
      setStatus("Ошибка запуска", error.message, "error");
    }
  }

  async function pollJob(statusUrl) {
    stopPolling();

    async function tick() {
      try {
        const response = await fetch(statusUrl);
        const payload = await response.json();
        if (!response.ok) {
          throw new Error(payload.detail || "Не удалось получить статус задачи.");
        }

        if (payload.status === "queued" || payload.status === "running") {
          setStatus(
            payload.status === "queued" ? "Задача в очереди" : "Backend строит граф",
            "Продолжаю опрашивать статус. Это может занять время для профилей с большим числом связей.",
            "loading",
          );
          state.pollHandle = window.setTimeout(tick, pollIntervalMs);
          return;
        }

        setLoadingState(false);

        if (payload.status === "failed") {
          setStatus("Задача завершилась ошибкой", payload.error_message || "Неизвестная ошибка backend.", "error");
          return;
        }

        if (!payload.result) {
          setStatus("Пустой ответ", "Backend вернул успешный статус, но без результата.", "error");
          return;
        }

        renderResult(payload.result);
        setStatus("Граф готов", "Загрузка завершена. Можно изучать связи и общих друзей на графе ниже.", "success");
      } catch (error) {
        setLoadingState(false);
        setStatus("Ошибка polling", error.message, "error");
      }
    }

    tick();
  }

  function stopPolling() {
    if (state.pollHandle !== null) {
      window.clearTimeout(state.pollHandle);
      state.pollHandle = null;
    }
  }

  function setLoadingState(isLoading) {
    submitButton.disabled = isLoading;
    addProfileButton.disabled = isLoading || profilesList.children.length >= maxProfiles;
    highlightAllButton.disabled = isLoading;
    resetViewButton.disabled = isLoading;
    [...profilesList.querySelectorAll(".profile-input, .icon-button")].forEach((element) => {
      element.disabled = isLoading;
    });
  }

  function setStatus(title, text, kind) {
    statusPanel.classList.remove("is-loading", "is-success", "is-error");
    if (kind === "loading") {
      statusPanel.classList.add("is-loading");
    } else if (kind === "success") {
      statusPanel.classList.add("is-success");
    } else if (kind === "error") {
      statusPanel.classList.add("is-error");
    }

    statusTitle.textContent = title;
    statusText.textContent = text;
  }

  function clearGraph() {
    state.result = null;
    state.intersectionGroups = [];
    state.focusKey = null;
    state.focusLabel = null;
    emptyState.hidden = false;
    renderer.clear();
    seedProfilesList.innerHTML = "";
    overlapsList.innerHTML = "";
    seedCountElement.textContent = "0";
    nodeCountElement.textContent = "0";
    sharedCountElement.textContent = "0";
    updateFocusUi();
  }

  function renderResult(result) {
    state.result = result;
    state.intersectionGroups = buildIntersectionGroups(result);
    emptyState.hidden = true;
    seedCountElement.textContent = String(result.stats.seed_count);
    nodeCountElement.textContent = String(result.stats.node_count);
    sharedCountElement.textContent = String(result.stats.shared_node_count);

    renderSeedProfiles(result.seed_profiles);
    renderOverlaps(state.intersectionGroups);
    renderer.setData(result);
    applyFocus(null);
  }

  function renderSeedProfiles(seedProfiles) {
    seedProfilesList.innerHTML = "";
    seedProfiles.forEach((profile) => {
      const card = document.createElement("article");
      const focusKey = `seed:${profile.seed_index}`;
      card.className = "seed-card";
      card.dataset.focusKey = focusKey;

      const head = document.createElement("div");
      head.className = "seed-card-head";

      const identity = document.createElement("div");
      identity.className = "seed-card-identity";

      if (profile.avatar_url) {
        const avatar = document.createElement("img");
        avatar.className = "seed-avatar";
        avatar.src = profile.avatar_url;
        avatar.alt = profile.full_name;
        avatar.loading = "lazy";
        avatar.referrerPolicy = "no-referrer";
        identity.appendChild(avatar);
      } else {
        const placeholder = document.createElement("div");
        placeholder.className = "seed-avatar";
        identity.appendChild(placeholder);
      }

      const copy = document.createElement("div");
      copy.className = "seed-card-copy";
      copy.innerHTML = `
        <h3>${escapeHtml(profile.full_name)}</h3>
        <p>${escapeHtml(profile.input_profile)}</p>
      `;
      identity.appendChild(copy);

      const flag = document.createElement("span");
      flag.className = "flag seed";
      flag.textContent = `#${profile.seed_index + 1}`;

      head.append(identity, flag);

      const details = document.createElement("p");
      const truncatedLabel = profile.is_truncated
        ? `Показано ${profile.connection_count} из ${profile.total_available_connection_count}.`
        : `Связей: ${profile.connection_count}.`;
      details.textContent = `${sourceLabel(profile.source_kind)}. ${profile.is_private ? "Профиль закрыт." : truncatedLabel}`;

      const flags = document.createElement("div");
      flags.className = "seed-flags";
      flags.appendChild(buildFlag(profile.source_kind === "private" ? "private" : "source", sourceLabel(profile.source_kind)));
      if (profile.is_truncated) {
        flags.appendChild(buildFlag("warn", "Результат обрезан лимитом"));
      }
      if (profile.connection_count === 0) {
        flags.appendChild(buildFlag("error", "Нет доступных связей"));
      }

      const actions = document.createElement("div");
      actions.className = "seed-card-actions";

      const actionButton = document.createElement("button");
      actionButton.type = "button";
      actionButton.className = "button ghost subtle";
      actionButton.dataset.toggleFocus = "true";
      actionButton.dataset.inactiveLabel = "Показать слой друзей";
      actionButton.dataset.activeLabel = "Снять выделение";
      actionButton.textContent = actionButton.dataset.inactiveLabel;
      actionButton.addEventListener("click", () => toggleSeedFocus(profile.seed_index));

      const actionMeta = document.createElement("span");
      actionMeta.className = "muted";
      actionMeta.textContent = `На графе: ${profile.connection_count} связей профиля #${profile.seed_index + 1}.`;

      actions.append(actionButton, actionMeta);
      card.append(head, details, flags, actions);
      seedProfilesList.appendChild(card);
    });

    updateActiveCards();
  }

  function renderOverlaps(groups) {
    overlapsList.innerHTML = "";
    if (!groups.length) {
      const empty = document.createElement("p");
      empty.className = "muted";
      empty.textContent = "Для одного профиля пересечений нет, а для нескольких пока не найдено общих друзей.";
      overlapsList.appendChild(empty);
      return;
    }

    groups.forEach((group) => {
      const card = document.createElement("article");
      card.className = "overlap-card";
      card.dataset.focusKey = group.key;

      const meta = document.createElement("div");
      meta.className = "overlap-meta";
      meta.appendChild(buildFlag("shared", group.kindLabel));
      meta.appendChild(buildFlag("seed", group.shortSeedLabel));

      const previewMarkup = group.previewNames.length
        ? `
          <div class="overlap-preview">
            ${group.previewNames.map((name) => `<span class="preview-chip">${escapeHtml(name)}</span>`).join("")}
            ${group.remainingCount > 0 ? `<span class="preview-chip">+${group.remainingCount} ещё</span>` : ""}
          </div>
        `
        : "";

      card.innerHTML = `
        <div class="overlap-card-head">
          <h3>${escapeHtml(group.title)}</h3>
          <span class="flag shared">${group.sharedCount}</span>
        </div>
        <p>Общих друзей: ${group.sharedCount}. В подсветку попадают все узлы, которые одновременно связаны с этой группой профилей.</p>
        ${previewMarkup}
      `;

      const actions = document.createElement("div");
      actions.className = "overlap-card-actions";

      const actionButton = document.createElement("button");
      actionButton.type = "button";
      actionButton.className = "button ghost subtle";
      actionButton.dataset.toggleFocus = "true";
      actionButton.dataset.inactiveLabel = "Подсветить на графе";
      actionButton.dataset.activeLabel = "Снять подсветку";
      actionButton.textContent = actionButton.dataset.inactiveLabel;
      actionButton.addEventListener("click", () => toggleIntersectionFocus(group));

      actions.append(meta, actionButton);
      card.append(actions);
      overlapsList.appendChild(card);
    });

    updateActiveCards();
  }

  function toggleSeedFocus(seedIndex) {
    const focusKey = `seed:${seedIndex}`;
    if (state.focusKey === focusKey) {
      applyFocus(null);
      return;
    }

    const profile = state.result?.seed_profiles.find((item) => item.seed_index === seedIndex);
    if (!profile || !state.result) {
      return;
    }

    const selectedNodeIds = new Set([profile.node_id]);
    state.result.nodes.forEach((node) => {
      if (node.node_id === profile.node_id || node.connected_seed_indices.includes(seedIndex)) {
        selectedNodeIds.add(node.node_id);
      }
    });

    applyFocus({
      key: focusKey,
      label: `Профиль #${seedIndex + 1}: ${profile.full_name}`,
      seedIndices: [seedIndex],
      nodeIds: [...selectedNodeIds],
    });
  }

  function toggleIntersectionFocus(group) {
    if (state.focusKey === group.key) {
      applyFocus(null);
      return;
    }

    if (!state.result) {
      return;
    }

    const selectedNodeIds = new Set(group.nodeIds);
    group.seedIndices.forEach((seedIndex) => {
      const seedProfile = state.result.seed_profiles.find((item) => item.seed_index === seedIndex);
      if (seedProfile) {
        selectedNodeIds.add(seedProfile.node_id);
      }
    });

    applyFocus({
      key: group.key,
      label: `${group.title}: ${group.sharedCount} общих друзей`,
      seedIndices: group.seedIndices,
      nodeIds: [...selectedNodeIds],
    });
  }

  function toggleAllSharedFocus() {
    if (!state.result) {
      return;
    }

    if (state.focusKey === ALL_SHARED_FOCUS_KEY) {
      applyFocus(null);
      return;
    }

    const selectedNodeIds = new Set();
    const activeSeedIndices = new Set();

    state.result.nodes.forEach((node) => {
      if (node.is_seed) {
        return;
      }

      if (node.connected_seed_indices.length >= 2) {
        selectedNodeIds.add(node.node_id);
        node.connected_seed_indices.forEach((seedIndex) => activeSeedIndices.add(seedIndex));
      }
    });

    if (!selectedNodeIds.size) {
      return;
    }

    state.result.seed_profiles.forEach((profile) => {
      if (activeSeedIndices.has(profile.seed_index)) {
        selectedNodeIds.add(profile.node_id);
      }
    });

    applyFocus({
      key: ALL_SHARED_FOCUS_KEY,
      label: `Все общие связи: ${state.result.stats.shared_node_count} общих друзей`,
      seedIndices: [...activeSeedIndices].sort((left, right) => left - right),
      nodeIds: [...selectedNodeIds],
    });
  }

  function applyFocus(focus) {
    state.focusKey = focus?.key || null;
    state.focusLabel = focus?.label || null;
    renderer.setFocus(focus);
    updateFocusUi();
    updateActiveCards();
  }

  function updateFocusUi() {
    focusState.hidden = !state.focusLabel;
    focusState.textContent = state.focusLabel || "";
    updateHighlightAllButton();
  }

  function updateViewportUi(viewportState) {
    const hasData = Boolean(viewportState?.hasData);
    zoomLevel.hidden = !hasData;
    resetViewButton.hidden = !hasData;
    zoomLevel.textContent = `${Math.round((viewportState?.scale || 1) * 100)}%`;
    resetViewButton.disabled = !hasData || !viewportState?.canReset;
  }

  function updateHighlightAllButton() {
    const hasData = Boolean(state.result);
    const hasSharedNodes = (state.result?.stats?.shared_node_count || 0) > 0;
    const isActive = state.focusKey === ALL_SHARED_FOCUS_KEY;

    highlightAllButton.hidden = !hasData;
    highlightAllButton.disabled = !hasData || !hasSharedNodes;
    highlightAllButton.textContent = isActive ? "Снять подсветку" : "Подсветить все связи";
  }

  function updateActiveCards() {
    document.querySelectorAll("[data-focus-key]").forEach((element) => {
      const isActive = element.dataset.focusKey === state.focusKey;
      element.classList.toggle("is-active", isActive);

      const button = element.querySelector("[data-toggle-focus]");
      if (button) {
        button.textContent = isActive ? button.dataset.activeLabel : button.dataset.inactiveLabel;
      }
    });
  }

  function buildIntersectionGroups(result) {
    const nodeById = new Map(result.nodes.map((node) => [node.node_id, node]));
    const groups = new Map();

    result.nodes
      .filter((node) => !node.is_seed && node.connected_seed_indices.length >= 2)
      .forEach((node) => {
        const sortedSeedIndices = [...node.connected_seed_indices].sort((left, right) => left - right);
        for (let size = 2; size <= sortedSeedIndices.length; size += 1) {
          for (const subset of combinations(sortedSeedIndices, size)) {
            const key = `subset:${subset.join("-")}`;
            if (!groups.has(key)) {
              groups.set(key, {
                key,
                seedIndices: subset,
                nodeIds: [],
              });
            }
            groups.get(key).nodeIds.push(node.node_id);
          }
        }
      });

    return [...groups.values()]
      .map((group) => {
        const uniqueNodeIds = [...new Set(group.nodeIds)];
        const previewNames = uniqueNodeIds
          .slice(0, 6)
          .map((nodeId) => nodeById.get(nodeId)?.full_name)
          .filter(Boolean);

        return {
          ...group,
          nodeIds: uniqueNodeIds,
          sharedCount: uniqueNodeIds.length,
          title: `Профили ${group.seedIndices.map((seedIndex) => `#${seedIndex + 1}`).join(" × ")}`,
          shortSeedLabel: group.seedIndices.map((seedIndex) => `#${seedIndex + 1}`).join(" · "),
          kindLabel: intersectionKindLabel(group.seedIndices.length),
          previewNames,
          remainingCount: Math.max(0, uniqueNodeIds.length - previewNames.length),
        };
      })
      .sort((left, right) => {
        if (left.seedIndices.length !== right.seedIndices.length) {
          return right.seedIndices.length - left.seedIndices.length;
        }
        if (left.sharedCount !== right.sharedCount) {
          return right.sharedCount - left.sharedCount;
        }
        return left.key.localeCompare(right.key);
      });
  }

  function buildFlag(kind, text) {
    const flag = document.createElement("span");
    flag.className = `flag ${kind === "warn" ? "warn" : kind === "private" ? "error" : kind === "shared" ? "shared" : "seed"}`;
    flag.textContent = text;
    return flag;
  }

  function sourceLabel(sourceKind) {
    if (sourceKind === "friends") return "Источник: друзья";
    if (sourceKind === "followers") return "Источник: подписчики";
    return "Источник: приватный профиль";
  }

  function intersectionKindLabel(seedCount) {
    if (seedCount === 2) return "Попарное";
    if (seedCount === 3) return "Тройное";
    if (seedCount === 4) return "Четверное";
    if (seedCount === 5) return "Пятикратное";
    return `${seedCount}-кратное`;
  }

  function escapeHtml(value) {
    return String(value)
      .replaceAll("&", "&amp;")
      .replaceAll("<", "&lt;")
      .replaceAll(">", "&gt;")
      .replaceAll('"', "&quot;");
  }
});

class GraphViewport {
  constructor(options = {}) {
    this.minScale = options.minScale || 0.35;
    this.maxScale = options.maxScale || 3.5;
    this.fitPadding = options.fitPadding || 72;
    this.overviewScaleFactor = options.overviewScaleFactor || (1 / 1.5);
    this.reset();
  }

  reset() {
    this.scale = 1;
    this.panX = 0;
    this.panY = 0;
    this.captureDefault();
  }

  captureDefault() {
    this.defaultScale = this.scale;
    this.defaultPanX = this.panX;
    this.defaultPanY = this.panY;
  }

  restoreDefault() {
    this.scale = this.defaultScale;
    this.panX = this.defaultPanX;
    this.panY = this.defaultPanY;
  }

  fitBounds(bounds, viewportWidth, viewportHeight) {
    if (!bounds) {
      this.reset();
      return;
    }

    const width = Math.max(bounds.maxX - bounds.minX, 1);
    const height = Math.max(bounds.maxY - bounds.minY, 1);
    const usableWidth = Math.max(viewportWidth - this.fitPadding * 2, viewportWidth * 0.4);
    const usableHeight = Math.max(viewportHeight - this.fitPadding * 2, viewportHeight * 0.4);

    let nextScale = Math.min(usableWidth / width, usableHeight / height);
    if (!Number.isFinite(nextScale) || nextScale <= 0) {
      nextScale = 1;
    }

    nextScale = clamp(nextScale, this.minScale, Math.min(this.maxScale, 1.45));
    nextScale = clamp(nextScale * this.overviewScaleFactor, this.minScale, this.maxScale);
    this.scale = nextScale;

    const centerX = bounds.minX + width / 2;
    const centerY = bounds.minY + height / 2;
    this.panX = viewportWidth / 2 - centerX * this.scale;
    this.panY = viewportHeight / 2 - centerY * this.scale;
    this.captureDefault();
  }

  panBy(deltaX, deltaY) {
    this.panX += deltaX;
    this.panY += deltaY;
  }

  zoomAt(nextScale, screenX, screenY) {
    const clampedScale = clamp(nextScale, this.minScale, this.maxScale);
    if (Math.abs(clampedScale - this.scale) < 0.0001) {
      return;
    }

    const worldPoint = this.screenToWorld(screenX, screenY);
    this.scale = clampedScale;
    this.panX = screenX - worldPoint.x * this.scale;
    this.panY = screenY - worldPoint.y * this.scale;
  }

  worldToScreen(x, y) {
    return {
      x: (x * this.scale) + this.panX,
      y: (y * this.scale) + this.panY,
    };
  }

  screenToWorld(x, y) {
    return {
      x: (x - this.panX) / this.scale,
      y: (y - this.panY) / this.scale,
    };
  }

  isDefaultView() {
    return (
      Math.abs(this.scale - this.defaultScale) < 0.001
      && Math.abs(this.panX - this.defaultPanX) < 0.5
      && Math.abs(this.panY - this.defaultPanY) < 0.5
    );
  }
}

class GraphLayoutEngine {
  constructor(result, viewportSize) {
    this.result = result;
    this.viewportWidth = Math.max(760, viewportSize.width || 760);
    this.viewportHeight = Math.max(560, viewportSize.height || 560);
    this.nodeCount = result.nodes.length;
    this.seedNodes = result.nodes
      .filter((node) => node.is_seed)
      .sort((left, right) => (left.seed_indices[0] || 0) - (right.seed_indices[0] || 0));
    this.connectionNodes = result.nodes
      .filter((node) => !node.is_seed)
      .sort((left, right) => {
        if (left.shared_seed_count !== right.shared_seed_count) {
          return right.shared_seed_count - left.shared_seed_count;
        }
        return hashString(left.node_id) - hashString(right.node_id);
      });

    this.worldScale = this.resolveWorldScale();
    this.worldWidth = this.viewportWidth * this.worldScale;
    this.worldHeight = this.viewportHeight * this.worldScale;
    this.centerX = this.worldWidth / 2;
    this.centerY = this.worldHeight / 2;
    this.sizeFactor = this.nodeCount > 320 ? 0.8 : this.nodeCount > 180 ? 0.9 : 1;
    this.seedRadius = Math.max(18, 22 * this.sizeFactor);
    this.sharedRadius = Math.max(9, 11 * this.sizeFactor);
    this.singleRadius = Math.max(7, 8.8 * this.sizeFactor);
    this.seedPositionsByIndex = new Map();
    this.layout = [];
  }

  createLayout() {
    this.placeSeedNodes();
    this.placeConnectionGroups();
    this.relaxConnectionNodes();
    return this.layout;
  }

  resolveWorldScale() {
    if (this.nodeCount > 1800) return 3.2;
    if (this.nodeCount > 1100) return 2.8;
    if (this.nodeCount > 600) return 2.25;
    if (this.nodeCount > 280) return 1.8;
    if (this.nodeCount > 140) return 1.45;
    if (this.nodeCount > 60) return 1.18;
    return 1.04;
  }

  placeSeedNodes() {
    if (this.seedNodes.length === 1) {
      const node = this.seedNodes[0];
      const position = { x: this.centerX, y: this.centerY };
      this.seedPositionsByIndex.set(node.seed_indices[0], position);
      this.layout.push(this.buildLayoutItem(node, {
        startX: this.centerX,
        startY: this.centerY,
        targetX: position.x,
        targetY: position.y,
        homeX: position.x,
        homeY: position.y,
        radius: this.seedRadius,
        fixed: true,
      }));
      return;
    }

    const orbitRadius = Math.min(this.worldWidth, this.worldHeight)
      * (0.25 + Math.min(this.seedNodes.length, 5) * 0.018 + Math.min(this.nodeCount / 2200, 0.08));

    this.seedNodes.forEach((node, idx) => {
      const angle = (-Math.PI / 2) + (idx / Math.max(this.seedNodes.length, 1)) * Math.PI * 2;
      const position = {
        x: this.centerX + Math.cos(angle) * orbitRadius,
        y: this.centerY + Math.sin(angle) * orbitRadius * 0.78,
      };

      this.seedPositionsByIndex.set(node.seed_indices[0], position);
      this.layout.push(this.buildLayoutItem(node, {
        startX: this.centerX,
        startY: this.centerY,
        targetX: position.x,
        targetY: position.y,
        homeX: position.x,
        homeY: position.y,
        radius: this.seedRadius,
        fixed: true,
      }));
    });
  }

  placeConnectionGroups() {
    const groups = this.collectGroups();
    groups.forEach((group, groupIndex) => this.placeGroup(group, groupIndex));
  }

  collectGroups() {
    const groups = new Map();

    this.connectionNodes.forEach((node) => {
      const seedIndices = [...node.connected_seed_indices].sort((left, right) => left - right);
      const key = seedIndices.length ? seedIndices.join("-") : "unlinked";

      if (!groups.has(key)) {
        groups.set(key, {
          key,
          seedIndices,
          nodes: [],
        });
      }

      groups.get(key).nodes.push(node);
    });

    return [...groups.values()]
      .map((group) => ({
        ...group,
        nodes: group.nodes.sort((left, right) => hashString(left.node_id) - hashString(right.node_id)),
      }))
      .sort((left, right) => {
        if (left.seedIndices.length !== right.seedIndices.length) {
          return right.seedIndices.length - left.seedIndices.length;
        }
        if (left.nodes.length !== right.nodes.length) {
          return right.nodes.length - left.nodes.length;
        }
        return left.key.localeCompare(right.key);
      });
  }

  placeGroup(group, groupIndex) {
    const config = this.buildGroupConfig(group, groupIndex);
    const nodeSpacing = Math.max(26, (config.radius * 2) + 9);
    let cursor = 0;
    let ringIndex = 0;

    while (cursor < group.nodes.length) {
      const ringRadius = config.baseRadius + ringIndex * config.ringGap;
      const arcLength = Math.max(config.arcSpan * ringRadius, nodeSpacing * 5);
      const capacity = Math.max(config.minCapacity, Math.floor(arcLength / nodeSpacing));
      const ringNodes = group.nodes.slice(cursor, cursor + capacity);

      ringNodes.forEach((node, localIndex) => {
        const angle = this.resolveRingAngle(config, node, ringNodes.length, localIndex, ringIndex);
        const jitter = ((((hashString(`${node.node_id}:${ringIndex}`) % 1000) / 1000) - 0.5) * config.ringGap * 0.2);
        const targetX = config.anchorX + Math.cos(angle) * (ringRadius + jitter);
        const targetY = config.anchorY + Math.sin(angle) * (ringRadius + jitter) * config.verticalScale;

        this.layout.push(this.buildLayoutItem(node, {
          startX: config.anchorX,
          startY: config.anchorY,
          targetX,
          targetY,
          homeX: targetX,
          homeY: targetY,
          radius: config.radius,
          fixed: false,
        }));
      });

      cursor += ringNodes.length;
      ringIndex += 1;
    }
  }

  buildGroupConfig(group, groupIndex) {
    const anchors = group.seedIndices
      .map((seedIndex) => this.seedPositionsByIndex.get(seedIndex))
      .filter(Boolean);

    const anchorX = anchors.length ? average(anchors.map((anchor) => anchor.x)) : this.centerX;
    const anchorY = anchors.length ? average(anchors.map((anchor) => anchor.y)) : this.centerY;
    const radius = group.seedIndices.length > 1 ? this.sharedRadius : this.singleRadius;

    if (anchors.length === 1) {
      const seedPosition = anchors[0];
      const outwardAngle = this.seedNodes.length === 1
        ? ((hashString(group.key) % 360) * Math.PI) / 180
        : Math.atan2(seedPosition.y - this.centerY, seedPosition.x - this.centerX);

      return {
        anchorX: seedPosition.x,
        anchorY: seedPosition.y,
        centerAngle: outwardAngle,
        angleOffset: outwardAngle - (Math.PI * 0.55),
        arcSpan: this.seedNodes.length === 1 ? Math.PI * 2 : Math.PI * 1.18,
        baseRadius: this.seedNodes.length === 1
          ? 86 + Math.min(group.nodes.length, 42) * 0.28
          : 92 + Math.min(group.nodes.length, 28) * 0.34,
        ringGap: 28 + radius * 1.65,
        radius,
        minCapacity: this.seedNodes.length === 1 ? 8 : 6,
        verticalScale: 0.8,
      };
    }

    return {
      anchorX,
      anchorY,
      centerAngle: ((hashString(group.key) % 360) * Math.PI) / 180,
      angleOffset: ((hashString(`${group.key}:${groupIndex}`) % 360) * Math.PI) / 180,
      arcSpan: Math.PI * 2,
      baseRadius: 58 + (group.seedIndices.length * 18) + Math.min(group.nodes.length, 30) * 0.22,
      ringGap: 24 + radius * 1.55,
      radius,
      minCapacity: 6,
      verticalScale: 0.86,
    };
  }

  resolveRingAngle(config, node, ringLength, localIndex, ringIndex) {
    const hashOffset = ((((hashString(`${node.node_id}:angle`) % 1000) / 1000) - 0.5)
      * Math.min(0.14, config.arcSpan / Math.max(10, ringLength * 5)));

    if (config.arcSpan >= Math.PI * 1.95) {
      return config.angleOffset + (((localIndex + 0.5) / ringLength) * Math.PI * 2) + hashOffset;
    }

    if (ringLength === 1) {
      return config.centerAngle + hashOffset;
    }

    const progress = localIndex / Math.max(1, ringLength - 1);
    const spread = (config.centerAngle - config.arcSpan / 2) + (progress * config.arcSpan);
    return spread + hashOffset + (((ringIndex % 2) * 2 - 1) * 0.035);
  }

  relaxConnectionNodes() {
    const items = this.layout;
    const movableCount = items.filter((item) => !item.fixed).length;
    if (movableCount < 2) {
      return;
    }

    const iterations = this.nodeCount > 1400
      ? 6
      : this.nodeCount > 800
        ? 8
        : this.nodeCount > 320
          ? 10
          : 14;
    const padding = this.nodeCount > 1400
      ? 2.5
      : this.nodeCount > 800
        ? 3.5
        : 5.5;
    const maxRadius = items.reduce((maxValue, item) => Math.max(maxValue, item.radius), 0);
    const cellSize = Math.max(36, maxRadius * 3.2);
    const bounds = {
      minX: 30,
      minY: 30,
      maxX: this.worldWidth - 30,
      maxY: this.worldHeight - 30,
    };

    for (let iteration = 0; iteration < iterations; iteration += 1) {
      const attraction = Math.max(0.045, 0.12 - iteration * 0.008);

      items.forEach((item) => {
        if (item.fixed) return;
        item.targetX += (item.homeX - item.targetX) * attraction;
        item.targetY += (item.homeY - item.targetY) * attraction;
      });

      const grid = buildSpatialGrid(items, cellSize);

      items.forEach((item, index) => {
        const cellX = Math.floor(item.targetX / cellSize);
        const cellY = Math.floor(item.targetY / cellSize);

        for (let offsetX = -1; offsetX <= 1; offsetX += 1) {
          for (let offsetY = -1; offsetY <= 1; offsetY += 1) {
            const bucket = grid.get(`${cellX + offsetX}:${cellY + offsetY}`);
            if (!bucket) continue;

            bucket.forEach((otherIndex) => {
              if (otherIndex <= index) return;
              resolveCollision(items[index], items[otherIndex], padding);
            });
          }
        }
      });

      items.forEach((item) => {
        if (item.fixed) return;
        item.targetX = clamp(item.targetX, bounds.minX, bounds.maxX);
        item.targetY = clamp(item.targetY, bounds.minY, bounds.maxY);
      });
    }
  }

  buildLayoutItem(node, geometry) {
    return {
      node,
      startX: geometry.startX,
      startY: geometry.startY,
      targetX: geometry.targetX,
      targetY: geometry.targetY,
      homeX: geometry.homeX,
      homeY: geometry.homeY,
      radius: geometry.radius,
      fixed: geometry.fixed,
    };
  }
}

class GraphRenderer {
  constructor(canvas, tooltip) {
    this.canvas = canvas;
    this.tooltip = tooltip;
    this.ctx = canvas.getContext("2d");
    this.result = null;
    this.focus = null;
    this.renderProfile = null;
    this.currentPositions = new Map();
    this.hitItems = [];
    this.hoveredNodeId = null;
    this.nodeLayout = [];
    this.nodeLayoutById = new Map();
    this.connectionIndex = new Map();
    this.imageCache = new Map();
    this.avatarSpriteCache = new Map();
    this.viewport = new GraphViewport();
    this.viewportListener = null;
    this.dragState = null;
    this.layoutDirty = false;
    this.animationFrameId = null;
    this.animationStart = 0;
    this.pendingRender = false;
    this.canvasMetrics = null;
    this.bindEvents();
    this.clear();
  }

  bindEvents() {
    this.canvas.addEventListener("pointerdown", (event) => this.onPointerDown(event));
    this.canvas.addEventListener("pointermove", (event) => this.onPointerMove(event));
    this.canvas.addEventListener("pointerup", (event) => this.onPointerUp(event));
    this.canvas.addEventListener("pointercancel", (event) => this.onPointerUp(event));
    this.canvas.addEventListener("pointerleave", () => {
      if (!this.dragState?.isPanning) {
        this.hoveredNodeId = null;
        this.tooltip.hidden = true;
      }
    });
    this.canvas.addEventListener("wheel", (event) => this.onWheel(event), { passive: false });
  }

  setViewportListener(listener) {
    this.viewportListener = listener;
    this.notifyViewportChange();
  }

  setData(result) {
    this.result = result;
    this.focus = null;
    this.renderProfile = this.resolveRenderProfile(result);
    this.currentPositions = new Map();
    this.hitItems = [];
    this.hoveredNodeId = null;
    this.avatarSpriteCache.clear();
    this.nodeLayout = this.buildLayout(result);
    this.reindexLayout();
    this.connectionIndex = this.buildConnectionIndex(result.edges);
    this.preloadAvatars(result.nodes);
    this.canvas.classList.add("is-interactive");
    this.canvas.classList.remove("is-panning");
    this.fitViewToLayout();
    this.animationStart = performance.now();
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
    this.animate();
    this.notifyViewportChange();
  }

  setFocus(focus) {
    this.focus = focus
      ? {
          ...focus,
          nodeIds: new Set(focus.nodeIds || []),
        }
      : null;
    this.requestRender();
  }

  resetView() {
    if (!this.result) {
      return;
    }

    this.stopAnimation();
    this.tooltip.hidden = true;
    this.fitViewToLayout();
    this.notifyViewportChange();
    this.requestRender();
  }

  handleResize() {
    this.resizeCanvas();
    if (!this.result) {
      this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
      return;
    }

    this.stopAnimation();
    this.nodeLayout = this.buildLayout(this.result);
    this.reindexLayout();
    this.fitViewToLayout();
    this.notifyViewportChange();
    this.requestRender();
  }

  clear() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }

    this.result = null;
    this.focus = null;
    this.renderProfile = null;
    this.dragState = null;
    this.currentPositions = new Map();
    this.hitItems = [];
    this.hoveredNodeId = null;
    this.nodeLayout = [];
    this.nodeLayoutById = new Map();
    this.connectionIndex = new Map();
    this.avatarSpriteCache.clear();
    this.viewport.reset();
    this.layoutDirty = false;
    this.canvas.classList.remove("is-interactive", "is-panning");
    this.resizeCanvas();
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.tooltip.hidden = true;
    this.notifyViewportChange();
  }

  preloadAvatars(nodes) {
    nodes.forEach((node) => {
      if (node.avatar_url) {
        this.ensureAvatar(node.avatar_url);
      }
    });
  }

  ensureAvatar(url) {
    if (this.imageCache.has(url)) {
      return this.imageCache.get(url);
    }

    const image = new Image();
    image.decoding = "async";
    image.loading = "eager";
    image.referrerPolicy = "no-referrer";

    const entry = { status: "loading", image };
    image.onload = () => {
      entry.status = "loaded";
      this.avatarSpriteCache.forEach((_, cacheKey) => {
        if (cacheKey.startsWith(`${url}@`)) {
          this.avatarSpriteCache.delete(cacheKey);
        }
      });
      this.requestRender();
    };
    image.onerror = () => {
      entry.status = "error";
      this.avatarSpriteCache.forEach((_, cacheKey) => {
        if (cacheKey.startsWith(`${url}@`)) {
          this.avatarSpriteCache.delete(cacheKey);
        }
      });
      this.requestRender();
    };
    image.src = url;

    this.imageCache.set(url, entry);
    return entry;
  }

  stopAnimation() {
    if (!this.animationFrameId) {
      return;
    }

    cancelAnimationFrame(this.animationFrameId);
    this.animationFrameId = null;
    this.render(1);
  }

  requestRender() {
    if (this.pendingRender) {
      return;
    }

    this.pendingRender = true;
    requestAnimationFrame(() => {
      this.pendingRender = false;
      this.render();
    });
  }

  notifyViewportChange() {
    if (!this.viewportListener) {
      return;
    }

    this.viewportListener({
      hasData: Boolean(this.result),
      scale: this.viewport.scale,
      canReset: Boolean(this.result) && (!this.viewport.isDefaultView() || this.layoutDirty),
    });
  }

  reindexLayout() {
    this.nodeLayoutById = new Map(this.nodeLayout.map((item) => [item.node.node_id, item]));
  }

  buildConnectionIndex(edges) {
    const index = new Map();

    edges.forEach((edge) => {
      if (!index.has(edge.source_node_id)) {
        index.set(edge.source_node_id, new Set());
      }
      if (!index.has(edge.target_node_id)) {
        index.set(edge.target_node_id, new Set());
      }

      index.get(edge.source_node_id).add(edge.target_node_id);
      index.get(edge.target_node_id).add(edge.source_node_id);
    });

    return index;
  }

  resizeCanvas() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    const width = Math.max(1, Math.floor(rect.width * dpr));
    const height = Math.max(1, Math.floor(rect.height * dpr));

    if (
      this.canvasMetrics
      && this.canvasMetrics.width === width
      && this.canvasMetrics.height === height
      && this.canvasMetrics.dpr === dpr
    ) {
      return rect;
    }

    this.canvas.width = width;
    this.canvas.height = height;
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.canvasMetrics = { width, height, dpr };
    return rect;
  }

  fitViewToLayout() {
    const rect = this.canvas.getBoundingClientRect();
    this.viewport.fitBounds(
      getLayoutBounds(this.nodeLayout),
      Math.max(1, rect.width || 1),
      Math.max(1, rect.height || 1),
    );
    this.layoutDirty = false;
  }

  render(progress = 1) {
    const rect = this.resizeCanvas();
    const width = rect.width;
    const height = rect.height;

    this.ctx.clearRect(0, 0, width, height);
    if (!this.result || !this.nodeLayout.length) {
      return;
    }

    const positions = new Map();
    for (const layoutNode of this.nodeLayout) {
      const worldX = lerp(layoutNode.startX, layoutNode.targetX, progress);
      const worldY = lerp(layoutNode.startY, layoutNode.targetY, progress);
      const screenPoint = this.viewport.worldToScreen(worldX, worldY);
      positions.set(layoutNode.node.node_id, {
        x: screenPoint.x,
        y: screenPoint.y,
        worldX,
        worldY,
        radius: Math.max(2.6, layoutNode.radius * this.viewport.scale),
        worldRadius: layoutNode.radius,
        node: layoutNode.node,
      });
    }

    const nodeBounds = createScreenBounds(width, height, this.renderProfile?.nodeCullPadding || 108);
    const edgeBounds = createScreenBounds(width, height, this.renderProfile?.edgeCullPadding || 148);
    this.drawBackdrop(width, height);
    this.drawEdges(positions, edgeBounds);
    this.drawNodes(positions, nodeBounds);
    this.currentPositions = positions;
  }

  animate() {
    const duration = 900;
    const now = performance.now();
    const progress = Math.min(1, (now - this.animationStart) / duration);
    const eased = easeOutCubic(progress);
    this.render(eased);

    if (progress < 1) {
      this.animationFrameId = requestAnimationFrame(() => this.animate());
      return;
    }

    this.animationFrameId = null;
  }

  drawBackdrop(width, height) {
    const gradient = this.ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, "rgba(244, 107, 69, 0.06)");
    gradient.addColorStop(1, "rgba(31, 122, 111, 0.05)");
    this.ctx.fillStyle = gradient;
    this.ctx.fillRect(0, 0, width, height);
    if (this.renderProfile?.showGrid) {
      this.drawGrid(width, height);
    }
  }

  drawGrid(width, height) {
    const minWorld = this.viewport.screenToWorld(0, 0);
    const maxWorld = this.viewport.screenToWorld(width, height);
    const baseStep = 140;
    const scaleFactor = this.viewport.scale > 1.6 ? 0.5 : this.viewport.scale < 0.7 ? 2 : 1;
    const step = baseStep * scaleFactor;

    this.ctx.save();
    this.ctx.strokeStyle = "rgba(20, 33, 43, 0.035)";
    this.ctx.lineWidth = 1;

    for (let x = Math.floor(minWorld.x / step) * step; x <= maxWorld.x + step; x += step) {
      const screenX = this.viewport.worldToScreen(x, 0).x;
      this.ctx.beginPath();
      this.ctx.moveTo(screenX, 0);
      this.ctx.lineTo(screenX, height);
      this.ctx.stroke();
    }

    for (let y = Math.floor(minWorld.y / step) * step; y <= maxWorld.y + step; y += step) {
      const screenY = this.viewport.worldToScreen(0, y).y;
      this.ctx.beginPath();
      this.ctx.moveTo(0, screenY);
      this.ctx.lineTo(width, screenY);
      this.ctx.stroke();
    }

    this.ctx.restore();
  }

  drawEdges(positions, visibleBounds) {
    const focusNodeIds = this.focus?.nodeIds || null;

    this.ctx.save();
    for (const edge of this.result.edges) {
      const source = positions.get(edge.source_node_id);
      const target = positions.get(edge.target_node_id);
      if (!source || !target) continue;
      if (!isSegmentVisible(source, target, visibleBounds)) continue;

      const isActive = !focusNodeIds || (focusNodeIds.has(edge.source_node_id) && focusNodeIds.has(edge.target_node_id));
      this.ctx.globalAlpha = isActive ? 1 : 0.08;
      this.ctx.lineWidth = clamp((edge.connected_seed_indices.length > 1 ? 1.8 : 1.15) * this.viewport.scale, 0.6, 2.8);
      this.ctx.strokeStyle = edge.connected_seed_indices.length > 1
        ? "rgba(31, 122, 111, 0.26)"
        : "rgba(20, 33, 43, 0.12)";

      this.ctx.beginPath();
      this.ctx.moveTo(source.x, source.y);
      this.ctx.lineTo(target.x, target.y);
      this.ctx.stroke();
    }
    this.ctx.restore();
  }

  drawNodes(positions, visibleBounds) {
    const visibleItems = [...positions.values()].filter((item) => isCircleVisible(item, visibleBounds));
    const ordered = visibleItems.sort((left, right) => {
      if (left.node.is_seed !== right.node.is_seed) {
        return left.node.is_seed ? -1 : 1;
      }
      return right.node.shared_seed_count - left.node.shared_seed_count;
    });
    this.hitItems = [...ordered].sort((left, right) => {
      if (left.node.is_seed !== right.node.is_seed) {
        return left.node.is_seed ? -1 : 1;
      }
      return right.radius - left.radius;
    });

    const labeledIds = new Set();
    const canRenderSeedLabels = this.viewport.scale >= (this.renderProfile?.minLabelScale || 0.74);
    const canRenderFocusLabels = this.viewport.scale >= (this.renderProfile?.minFocusLabelScale || 0.64);

    if (canRenderSeedLabels) {
      ordered
        .filter((item) => item.node.is_seed)
        .forEach((item) => labeledIds.add(item.node.node_id));
    }

    if (canRenderFocusLabels && this.focus && this.focus.nodeIds.size <= 12) {
      ordered
        .filter((item) => !item.node.is_seed && this.focus.nodeIds.has(item.node.node_id))
        .slice(0, this.renderProfile?.focusLabelLimit || 8)
        .forEach((item) => labeledIds.add(item.node.node_id));
    }

    for (const item of ordered) {
      const isActive = !this.focus || this.focus.nodeIds.has(item.node.node_id);
      this.drawNode(item, isActive);
    }

    for (const item of ordered) {
      if (!labeledIds.has(item.node.node_id)) continue;
      if (this.focus && !this.focus.nodeIds.has(item.node.node_id)) continue;
      this.drawLabel(item);
    }
  }

  drawNode(item, isActive) {
    const ringColor = item.node.is_seed
      ? "#f46b45"
      : item.node.shared_seed_count >= 2
        ? "#1f7a6f"
        : "#5f6f86";

    this.ctx.save();
    this.ctx.globalAlpha = isActive ? 1 : 0.14;
    if (this.renderProfile?.showShadows && isActive) {
      this.ctx.shadowBlur = clamp(item.radius * 0.65, 0, 18);
      this.ctx.shadowColor = item.node.shared_seed_count >= 2
        ? "rgba(31, 122, 111, 0.18)"
        : "rgba(20, 33, 43, 0.1)";
    } else {
      this.ctx.shadowBlur = 0;
    }

    this.ctx.beginPath();
    this.ctx.arc(item.x, item.y, item.radius, 0, Math.PI * 2);
    this.ctx.fillStyle = "rgba(255, 255, 255, 0.96)";
    this.ctx.fill();

    const hasAvatar = this.drawAvatar(item);
    if (!hasAvatar) {
      this.ctx.beginPath();
      this.ctx.arc(item.x, item.y, Math.max(1, item.radius - 1.2), 0, Math.PI * 2);
      this.ctx.fillStyle = ringColor;
      this.ctx.fill();
      if (item.radius >= 9) {
        this.drawInitials(item);
      }
    }

    this.ctx.beginPath();
    this.ctx.arc(item.x, item.y, item.radius, 0, Math.PI * 2);
    this.ctx.lineWidth = clamp((item.node.is_seed ? 3.4 : item.node.shared_seed_count >= 2 ? 2.2 : 1.6) * this.viewport.scale, 1.1, 4);
    this.ctx.strokeStyle = ringColor;
    this.ctx.stroke();

    if (this.focus && isActive) {
      this.ctx.beginPath();
      this.ctx.arc(item.x, item.y, item.radius + clamp(4.5 * this.viewport.scale, 2.6, 6.2), 0, Math.PI * 2);
      this.ctx.lineWidth = clamp(1.3 * this.viewport.scale, 0.8, 2);
      this.ctx.strokeStyle = "rgba(214, 164, 77, 0.55)";
      this.ctx.stroke();
    }

    this.ctx.restore();
  }

  drawAvatar(item) {
    if (!item.node.avatar_url || item.radius < 4.5) {
      return false;
    }

    const sprite = this.ensureAvatarSprite(item.node.avatar_url, item.radius);
    if (!sprite) {
      return false;
    }

    this.ctx.drawImage(
      sprite,
      item.x - sprite.width / 2,
      item.y - sprite.height / 2,
      sprite.width,
      sprite.height,
    );
    return true;
  }

  ensureAvatarSprite(url, radius) {
    const bucketSize = this.resolveAvatarBucketSize(radius);
    const cacheKey = `${url}@${bucketSize}`;
    if (this.avatarSpriteCache.has(cacheKey)) {
      return this.avatarSpriteCache.get(cacheKey);
    }

    const avatarEntry = this.ensureAvatar(url);
    if (avatarEntry?.status !== "loaded") {
      return null;
    }

    const sprite = createAvatarSprite(avatarEntry.image, bucketSize);
    this.avatarSpriteCache.set(cacheKey, sprite);
    return sprite;
  }

  resolveAvatarBucketSize(radius) {
    const diameter = Math.max(8, Math.ceil((radius - 1.2) * 2));
    const buckets = this.renderProfile?.avatarBuckets || DEFAULT_AVATAR_BUCKETS;

    for (const bucket of buckets) {
      if (diameter <= bucket) {
        return bucket;
      }
    }

    return buckets[buckets.length - 1];
  }

  drawInitials(item) {
    const initials = buildInitials(item.node.full_name || item.node.node_id);
    this.ctx.save();
    this.ctx.fillStyle = "rgba(255, 255, 255, 0.96)";
    this.ctx.font = `${Math.max(8, Math.floor(item.radius * 0.9))}px "Avenir Next", sans-serif`;
    this.ctx.textAlign = "center";
    this.ctx.textBaseline = "middle";
    this.ctx.fillText(initials, item.x, item.y + 0.5);
    this.ctx.restore();
  }

  drawLabel(item) {
    const label = trimLabel(item.node.full_name || item.node.node_id, item.node.is_seed ? 24 : 18);
    this.ctx.save();
    this.ctx.font = item.node.is_seed
      ? `${clamp(12 * this.viewport.scale, 10, 18)}px 'Avenir Next', sans-serif`
      : `${clamp(11 * this.viewport.scale, 9, 15)}px 'Avenir Next', sans-serif`;
    this.ctx.fillStyle = "rgba(20, 33, 43, 0.88)";
    this.ctx.textAlign = "center";
    this.ctx.fillText(label, item.x, item.y - item.radius - clamp(10 * this.viewport.scale, 8, 16));
    this.ctx.restore();
  }

  buildLayout(result) {
    const rect = this.canvas.getBoundingClientRect();
    return new GraphLayoutEngine(result, {
      width: rect.width || 0,
      height: rect.height || 0,
    }).createLayout();
  }

  resolveRenderProfile(result) {
    const nodeCount = result.nodes.length;
    return {
      showGrid: nodeCount <= 420,
      showShadows: nodeCount <= 320,
      focusLabelLimit: nodeCount <= 180 ? 8 : nodeCount <= 360 ? 5 : 3,
      nodeCullPadding: nodeCount <= 240 ? 132 : nodeCount <= 520 ? 108 : 92,
      edgeCullPadding: nodeCount <= 240 ? 168 : nodeCount <= 520 ? 144 : 120,
      minLabelScale: nodeCount <= 240 ? 0.68 : nodeCount <= 520 ? 0.8 : 0.92,
      minFocusLabelScale: nodeCount <= 240 ? 0.6 : nodeCount <= 520 ? 0.72 : 0.82,
      avatarBuckets: nodeCount <= 220
        ? [12, 16, 20, 24, 28, 36, 48, 64, 80]
        : nodeCount <= 520
          ? [12, 16, 20, 24, 32, 44, 60]
          : [12, 16, 20, 24, 32, 40, 52],
    };
  }

  onPointerDown(event) {
    if (!this.result || event.button !== 0) {
      return;
    }

    this.stopAnimation();
    const rect = this.canvas.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;
    const hitNode = this.getHitNode(pointerX, pointerY);

    if (hitNode) {
      const pointerWorld = this.viewport.screenToWorld(pointerX, pointerY);
      this.dragState = this.createNodeDragState(hitNode, pointerWorld, event.pointerId);
      this.canvas.classList.add("is-panning");
      this.tooltip.hidden = true;
      this.canvas.setPointerCapture(event.pointerId);
      return;
    }

    this.dragState = {
      mode: "pan",
      pointerId: event.pointerId,
      originX: event.clientX,
      originY: event.clientY,
      lastX: event.clientX,
      lastY: event.clientY,
      isPanning: false,
    };
    this.canvas.setPointerCapture(event.pointerId);
  }

  onPointerMove(event) {
    if (this.dragState && event.pointerId === this.dragState.pointerId) {
      if (this.dragState.mode === "node") {
        const rect = this.canvas.getBoundingClientRect();
        const pointerX = event.clientX - rect.left;
        const pointerY = event.clientY - rect.top;
        const pointerWorld = this.viewport.screenToWorld(pointerX, pointerY);
        const layoutNode = this.nodeLayoutById.get(this.dragState.nodeId);

        if (layoutNode) {
          const nextX = pointerWorld.x + this.dragState.offsetX;
          const nextY = pointerWorld.y + this.dragState.offsetY;
          this.applyDraggedNodePosition(layoutNode, nextX, nextY, this.dragState);
          this.layoutDirty = true;
          this.tooltip.hidden = true;
          this.notifyViewportChange();
          this.requestRender();
        }
        return;
      }

      const deltaX = event.clientX - this.dragState.lastX;
      const deltaY = event.clientY - this.dragState.lastY;
      const movedEnough = Math.hypot(
        event.clientX - this.dragState.originX,
        event.clientY - this.dragState.originY,
      ) >= 3;

      this.dragState.lastX = event.clientX;
      this.dragState.lastY = event.clientY;

      if (movedEnough) {
        this.dragState.isPanning = true;
        this.canvas.classList.add("is-panning");
        this.tooltip.hidden = true;
        this.viewport.panBy(deltaX, deltaY);
        this.notifyViewportChange();
        this.requestRender();
        return;
      }
    }

    this.updateHover(event);
  }

  onPointerUp(event) {
    if (!this.dragState || event.pointerId !== this.dragState.pointerId) {
      return;
    }

    if (this.canvas.hasPointerCapture(event.pointerId)) {
      this.canvas.releasePointerCapture(event.pointerId);
    }

    const finishedDragState = this.dragState;
    const wasPanning = this.dragState.mode === "pan" && this.dragState.isPanning;
    this.dragState = null;
    this.canvas.classList.remove("is-panning");

    if (finishedDragState.mode === "node") {
      this.commitDraggedNodeState(finishedDragState);
    }

    if (!wasPanning) {
      this.updateHover(event);
    }
  }

  onWheel(event) {
    if (!this.result) {
      return;
    }

    event.preventDefault();
    this.stopAnimation();
    const rect = this.canvas.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;
    const zoomFactor = Math.exp(-event.deltaY * (event.ctrlKey ? 0.0025 : 0.0016));

    this.viewport.zoomAt(this.viewport.scale * zoomFactor, pointerX, pointerY);
    this.tooltip.hidden = true;
    this.notifyViewportChange();
    this.requestRender();
  }

  updateHover(event) {
    if (!this.currentPositions || !this.currentPositions.size) {
      return;
    }

    const rect = this.canvas.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;
    const hovered = this.getHitNode(pointerX, pointerY);

    if (!hovered) {
      this.hoveredNodeId = null;
      this.tooltip.hidden = true;
      return;
    }

    const relationshipLabel = hovered.node.is_seed
      ? `Исходный профиль #${(hovered.node.seed_indices[0] || 0) + 1}`
      : hovered.node.connected_seed_indices.length > 1
        ? `Общий друг профилей ${hovered.node.connected_seed_indices.map((index) => `#${index + 1}`).join(", ")}`
        : `Друг профиля #${(hovered.node.connected_seed_indices[0] || 0) + 1}`;

    if (this.hoveredNodeId !== hovered.node.node_id) {
      this.tooltip.innerHTML = `
        <strong>${escapeTooltip(hovered.node.full_name)}</strong><br>
        <span>${escapeTooltip(relationshipLabel)}</span>
      `;
      this.hoveredNodeId = hovered.node.node_id;
    }
    this.tooltip.style.left = `${pointerX}px`;
    this.tooltip.style.top = `${pointerY}px`;
    this.tooltip.hidden = false;
  }

  getHitNode(pointerX, pointerY) {
    const focusNodeIds = this.focus?.nodeIds || null;
    const hoverOrder = this.hitItems.length ? this.hitItems : [...this.currentPositions.values()];

    for (const item of hoverOrder) {
      if (focusNodeIds && !focusNodeIds.has(item.node.node_id)) {
        continue;
      }

      const distance = Math.hypot(pointerX - item.x, pointerY - item.y);
      if (distance <= item.radius + 5) {
        return item;
      }
    }

    return null;
  }

  createNodeDragState(hitNode, pointerWorld, pointerId) {
    const dragProfile = this.resolveDragProfile(hitNode.node);
    const influenceMap = this.collectDragInfluences(hitNode.node.node_id, dragProfile);
    const originPositions = new Map();

    originPositions.set(hitNode.node.node_id, {
      x: hitNode.worldX,
      y: hitNode.worldY,
    });

    influenceMap.forEach((_, nodeId) => {
      const layoutNode = this.nodeLayoutById.get(nodeId);
      if (!layoutNode) return;

      originPositions.set(nodeId, {
        x: layoutNode.targetX,
        y: layoutNode.targetY,
      });
    });

    return {
      mode: "node",
      pointerId,
      nodeId: hitNode.node.node_id,
      offsetX: hitNode.worldX - pointerWorld.x,
      offsetY: hitNode.worldY - pointerWorld.y,
      originX: hitNode.worldX,
      originY: hitNode.worldY,
      originPositions,
      influenceMap,
      dragProfile,
    };
  }

  collectDragInfluences(rootNodeId, dragProfile) {
    const influences = new Map();
    const visited = new Set([rootNodeId]);
    const queue = [{ nodeId: rootNodeId, depth: 0 }];
    const maxDepth = dragProfile.maxDepth;
    const maxNodes = dragProfile.maxNodes;

    while (queue.length && influences.size < maxNodes) {
      const current = queue.shift();
      if (!current || current.depth >= maxDepth) {
        continue;
      }

      const neighbors = this.connectionIndex.get(current.nodeId);
      if (!neighbors) {
        continue;
      }

      for (const neighborId of neighbors) {
        if (visited.has(neighborId)) {
          continue;
        }

        const neighborLayout = this.nodeLayoutById.get(neighborId);
        if (!neighborLayout) {
          continue;
        }

        visited.add(neighborId);
        const depth = current.depth + 1;
        influences.set(neighborId, {
          depth,
          weight: this.resolveMagnetWeight(depth, neighborLayout.node, dragProfile),
          slack: this.resolveMagnetSlack(depth, neighborLayout.node, dragProfile),
          smoothing: this.resolveMagnetSmoothing(depth, dragProfile),
        });

        if (depth < maxDepth && influences.size < maxNodes) {
          queue.push({ nodeId: neighborId, depth });
        }
      }
    }

    return influences;
  }

  resolveDragProfile(node) {
    if (node.is_seed) {
      return {
        kind: "seed",
        couplingScale: 1.14,
        slackShift: -12,
        smoothingScale: 1.06,
        maxDepth: 3,
        maxNodes: 120,
      };
    }

    if (node.shared_seed_count >= 2) {
      return {
        kind: "shared",
        couplingScale: 0.76,
        slackShift: 12,
        smoothingScale: 0.92,
        maxDepth: 3,
        maxNodes: 72,
      };
    }

    return {
      kind: "single",
      couplingScale: 0.62,
      slackShift: 18,
      smoothingScale: 0.86,
      maxDepth: 2,
      maxNodes: 46,
    };
  }

  resolveMagnetWeight(depth, node, dragProfile) {
    let weight = depth === 1 ? 0.34 : depth === 2 ? 0.17 : 0.09;
    if (node.is_seed) {
      weight *= 0.72;
    }
    if (node.shared_seed_count >= 2) {
      weight *= 1.08;
    }

    weight *= dragProfile.couplingScale;

    if (dragProfile.kind !== "seed" && node.is_seed) {
      weight *= 0.58;
    }

    return weight;
  }

  resolveMagnetSlack(depth, node, dragProfile) {
    let slack = depth === 1 ? 26 : depth === 2 ? 56 : 88;
    if (node.is_seed) {
      slack += 10;
    }
    slack += dragProfile.slackShift;
    if (dragProfile.kind !== "seed" && node.is_seed) {
      slack += 12;
    }
    return Math.max(10, slack);
  }

  resolveMagnetSmoothing(depth, dragProfile) {
    let smoothing = depth === 1 ? 0.34 : depth === 2 ? 0.24 : 0.18;
    smoothing *= dragProfile.smoothingScale;
    return clamp(smoothing, 0.12, 0.46);
  }

  applyDraggedNodePosition(layoutNode, nextX, nextY, dragState) {
    layoutNode.startX = nextX;
    layoutNode.startY = nextY;
    layoutNode.targetX = nextX;
    layoutNode.targetY = nextY;

    const dragDeltaX = nextX - dragState.originX;
    const dragDeltaY = nextY - dragState.originY;
    const dragDistance = Math.hypot(dragDeltaX, dragDeltaY);

    dragState.influenceMap.forEach((influence, nodeId) => {
      const affectedLayout = this.nodeLayoutById.get(nodeId);
      const origin = dragState.originPositions.get(nodeId);
      if (!affectedLayout || !origin) {
        return;
      }

      const activation = smoothstep(
        influence.slack,
        influence.slack + 130 + influence.depth * 32,
        dragDistance,
      );
      const desiredX = origin.x + (dragDeltaX * influence.weight * activation);
      const desiredY = origin.y + (dragDeltaY * influence.weight * activation);

      affectedLayout.targetX += (desiredX - affectedLayout.targetX) * influence.smoothing;
      affectedLayout.targetY += (desiredY - affectedLayout.targetY) * influence.smoothing;
      affectedLayout.startX = affectedLayout.targetX;
      affectedLayout.startY = affectedLayout.targetY;
    });
  }

  commitDraggedNodeState(dragState) {
    dragState.originPositions.forEach((_, nodeId) => {
      const layoutNode = this.nodeLayoutById.get(nodeId);
      if (!layoutNode) {
        return;
      }

      layoutNode.startX = layoutNode.targetX;
      layoutNode.startY = layoutNode.targetY;
      layoutNode.homeX = layoutNode.targetX;
      layoutNode.homeY = layoutNode.targetY;
    });
  }
}

function getLayoutBounds(nodeLayout) {
  if (!nodeLayout.length) {
    return null;
  }

  let minX = Number.POSITIVE_INFINITY;
  let minY = Number.POSITIVE_INFINITY;
  let maxX = Number.NEGATIVE_INFINITY;
  let maxY = Number.NEGATIVE_INFINITY;

  nodeLayout.forEach((item) => {
    minX = Math.min(minX, item.targetX - item.radius);
    minY = Math.min(minY, item.targetY - item.radius);
    maxX = Math.max(maxX, item.targetX + item.radius);
    maxY = Math.max(maxY, item.targetY + item.radius);
  });

  return { minX, minY, maxX, maxY };
}

function createScreenBounds(width, height, padding) {
  return {
    minX: -padding,
    minY: -padding,
    maxX: width + padding,
    maxY: height + padding,
  };
}

function isCircleVisible(item, bounds) {
  return (
    item.x + item.radius >= bounds.minX
    && item.x - item.radius <= bounds.maxX
    && item.y + item.radius >= bounds.minY
    && item.y - item.radius <= bounds.maxY
  );
}

function createAvatarSprite(image, size) {
  const surface = createCanvasSurface(size, size);
  const ctx = surface.getContext("2d");

  ctx.clearRect(0, 0, size, size);
  ctx.save();
  ctx.beginPath();
  ctx.arc(size / 2, size / 2, Math.max(1, size / 2), 0, Math.PI * 2);
  ctx.clip();
  ctx.imageSmoothingEnabled = true;
  if ("imageSmoothingQuality" in ctx) {
    ctx.imageSmoothingQuality = size >= 48 ? "high" : "medium";
  }
  ctx.drawImage(image, 0, 0, size, size);
  ctx.restore();

  return surface;
}

function createCanvasSurface(width, height) {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height);
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

function isSegmentVisible(source, target, bounds) {
  const minX = Math.min(source.x, target.x);
  const minY = Math.min(source.y, target.y);
  const maxX = Math.max(source.x, target.x);
  const maxY = Math.max(source.y, target.y);

  return (
    maxX >= bounds.minX
    && minX <= bounds.maxX
    && maxY >= bounds.minY
    && minY <= bounds.maxY
  );
}

function buildSpatialGrid(items, cellSize) {
  const grid = new Map();

  items.forEach((item, index) => {
    const cellX = Math.floor(item.targetX / cellSize);
    const cellY = Math.floor(item.targetY / cellSize);
    const key = `${cellX}:${cellY}`;
    if (!grid.has(key)) {
      grid.set(key, []);
    }
    grid.get(key).push(index);
  });

  return grid;
}

function resolveCollision(left, right, padding) {
  let deltaX = right.targetX - left.targetX;
  let deltaY = right.targetY - left.targetY;
  let distance = Math.hypot(deltaX, deltaY);
  const minDistance = left.radius + right.radius + padding;

  if (distance >= minDistance) {
    return;
  }

  if (distance < 0.001) {
    const fallbackAngle = ((hashString(`${left.node.node_id}:${right.node.node_id}`) % 360) * Math.PI) / 180;
    deltaX = Math.cos(fallbackAngle);
    deltaY = Math.sin(fallbackAngle);
    distance = 1;
  }

  const shift = (minDistance - distance) / distance;
  const pushX = deltaX * shift;
  const pushY = deltaY * shift;

  if (left.fixed && right.fixed) {
    return;
  }

  if (left.fixed) {
    right.targetX += pushX;
    right.targetY += pushY;
    return;
  }

  if (right.fixed) {
    left.targetX -= pushX;
    left.targetY -= pushY;
    return;
  }

  left.targetX -= pushX * 0.5;
  left.targetY -= pushY * 0.5;
  right.targetX += pushX * 0.5;
  right.targetY += pushY * 0.5;
}

function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function lerp(start, end, progress) {
  return start + (end - start) * progress;
}

function smoothstep(start, end, value) {
  if (end <= start) {
    return value >= end ? 1 : 0;
  }

  const progress = clamp((value - start) / (end - start), 0, 1);
  return progress * progress * (3 - (2 * progress));
}

function easeOutCubic(progress) {
  return 1 - Math.pow(1 - progress, 3);
}

function hashString(value) {
  let hash = 0;
  for (let idx = 0; idx < value.length; idx += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(idx);
    hash |= 0;
  }
  return Math.abs(hash);
}

function trimLabel(value, maxLength) {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 1)}…`;
}

function combinations(items, size) {
  const result = [];

  function walk(startIndex, current) {
    if (current.length === size) {
      result.push([...current]);
      return;
    }

    for (let index = startIndex; index < items.length; index += 1) {
      current.push(items[index]);
      walk(index + 1, current);
      current.pop();
    }
  }

  walk(0, []);
  return result;
}

function buildInitials(value) {
  const parts = String(value)
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2);

  if (!parts.length) {
    return "?";
  }

  return parts.map((part) => part[0].toUpperCase()).join("");
}

function escapeTooltip(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
