window.addEventListener("DOMContentLoaded", function () {
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
  const clearFocusButton = document.getElementById("clear-focus-button");

  const renderer = new GraphRenderer(canvas, tooltip);
  const state = {
    pollHandle: null,
    latestJobId: null,
    result: null,
    intersectionGroups: [],
    focusKey: null,
    focusLabel: null,
  };

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

    clearFocusButton.addEventListener("click", () => applyFocus(null));
    form.addEventListener("submit", onSubmit);
    window.addEventListener("resize", () => renderer.render());
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
    clearFocusButton.disabled = isLoading;
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

  function applyFocus(focus) {
    state.focusKey = focus?.key || null;
    state.focusLabel = focus?.label || null;
    renderer.setFocus(focus);
    updateFocusUi();
    updateActiveCards();
  }

  function updateFocusUi() {
    focusState.hidden = !state.focusLabel;
    clearFocusButton.hidden = !state.focusKey;
    focusState.textContent = state.focusLabel || "";
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

class GraphRenderer {
  constructor(canvas, tooltip) {
    this.canvas = canvas;
    this.tooltip = tooltip;
    this.ctx = canvas.getContext("2d");
    this.result = null;
    this.focus = null;
    this.currentPositions = new Map();
    this.nodeLayout = [];
    this.imageCache = new Map();
    this.animationFrameId = null;
    this.animationStart = 0;
    this.pendingRender = false;
    this.bindEvents();
    this.clear();
  }

  bindEvents() {
    this.canvas.addEventListener("mousemove", (event) => this.onPointerMove(event));
    this.canvas.addEventListener("mouseleave", () => {
      this.tooltip.hidden = true;
    });
  }

  setData(result) {
    this.result = result;
    this.focus = null;
    this.currentPositions = new Map();
    this.nodeLayout = this.buildLayout(result);
    this.preloadAvatars(result.nodes);
    this.animationStart = performance.now();
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
    }
    this.animate();
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

  clear() {
    if (this.animationFrameId) {
      cancelAnimationFrame(this.animationFrameId);
      this.animationFrameId = null;
    }
    this.result = null;
    this.focus = null;
    this.currentPositions = new Map();
    this.nodeLayout = [];
    this.resizeCanvas();
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.tooltip.hidden = true;
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
      this.requestRender();
    };
    image.onerror = () => {
      entry.status = "error";
      this.requestRender();
    };
    image.src = url;

    this.imageCache.set(url, entry);
    return entry;
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

  resizeCanvas() {
    const rect = this.canvas.getBoundingClientRect();
    const dpr = window.devicePixelRatio || 1;
    this.canvas.width = Math.max(1, Math.floor(rect.width * dpr));
    this.canvas.height = Math.max(1, Math.floor(rect.height * dpr));
    this.ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
  }

  render(progress = 1) {
    this.resizeCanvas();
    const width = this.canvas.getBoundingClientRect().width;
    const height = this.canvas.getBoundingClientRect().height;

    this.ctx.clearRect(0, 0, width, height);
    if (!this.result || !this.nodeLayout.length) {
      return;
    }

    const positions = new Map();
    for (const node of this.nodeLayout) {
      const x = lerp(node.startX, node.targetX, progress);
      const y = lerp(node.startY, node.targetY, progress);
      positions.set(node.node.node_id, { x, y, radius: node.radius, node: node.node });
    }

    this.drawBackdrop(width, height);
    this.drawEdges(positions);
    this.drawNodes(positions);
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
  }

  drawEdges(positions) {
    const focusNodeIds = this.focus?.nodeIds || null;

    this.ctx.save();
    for (const edge of this.result.edges) {
      const source = positions.get(edge.source_node_id);
      const target = positions.get(edge.target_node_id);
      if (!source || !target) continue;

      const isActive = !focusNodeIds || (focusNodeIds.has(edge.source_node_id) && focusNodeIds.has(edge.target_node_id));
      this.ctx.globalAlpha = isActive ? 1 : 0.08;
      this.ctx.lineWidth = isActive ? (edge.connected_seed_indices.length > 1 ? 1.8 : 1.15) : 0.9;
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

  drawNodes(positions) {
    const ordered = [...positions.values()].sort((left, right) => {
      if (left.node.is_seed !== right.node.is_seed) {
        return left.node.is_seed ? 1 : -1;
      }
      return left.node.shared_seed_count - right.node.shared_seed_count;
    });

    const labeledIds = new Set(
      ordered
        .filter((item) => item.node.is_seed)
        .map((item) => item.node.node_id),
    );

    if (this.focus && this.focus.nodeIds.size <= 12) {
      ordered
        .filter((item) => !item.node.is_seed && this.focus.nodeIds.has(item.node.node_id))
        .sort((left, right) => right.node.shared_seed_count - left.node.shared_seed_count)
        .slice(0, 8)
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
    this.ctx.shadowBlur = isActive ? (item.node.is_seed ? 16 : 10) : 0;
    this.ctx.shadowColor = item.node.shared_seed_count >= 2
      ? "rgba(31, 122, 111, 0.18)"
      : "rgba(20, 33, 43, 0.1)";

    this.ctx.beginPath();
    this.ctx.arc(item.x, item.y, item.radius, 0, Math.PI * 2);
    this.ctx.fillStyle = "rgba(255, 255, 255, 0.96)";
    this.ctx.fill();

    const avatarEntry = item.node.avatar_url ? this.ensureAvatar(item.node.avatar_url) : null;
    if (avatarEntry?.status === "loaded") {
      this.ctx.save();
      this.ctx.beginPath();
      this.ctx.arc(item.x, item.y, item.radius - 1.2, 0, Math.PI * 2);
      this.ctx.clip();
      this.ctx.drawImage(
        avatarEntry.image,
        item.x - item.radius,
        item.y - item.radius,
        item.radius * 2,
        item.radius * 2,
      );
      this.ctx.restore();
    } else {
      this.ctx.beginPath();
      this.ctx.arc(item.x, item.y, item.radius - 1.2, 0, Math.PI * 2);
      this.ctx.fillStyle = ringColor;
      this.ctx.fill();
      this.drawInitials(item);
    }

    this.ctx.beginPath();
    this.ctx.arc(item.x, item.y, item.radius, 0, Math.PI * 2);
    this.ctx.lineWidth = item.node.is_seed ? 3.4 : item.node.shared_seed_count >= 2 ? 2.2 : 1.6;
    this.ctx.strokeStyle = ringColor;
    this.ctx.stroke();

    if (this.focus && isActive) {
      this.ctx.beginPath();
      this.ctx.arc(item.x, item.y, item.radius + 4.5, 0, Math.PI * 2);
      this.ctx.lineWidth = 1.3;
      this.ctx.strokeStyle = "rgba(214, 164, 77, 0.55)";
      this.ctx.stroke();
    }

    this.ctx.restore();
  }

  drawInitials(item) {
    const initials = buildInitials(item.node.full_name || item.node.node_id);
    this.ctx.save();
    this.ctx.fillStyle = "rgba(255, 255, 255, 0.96)";
    this.ctx.font = `${Math.max(8, Math.floor(item.radius * 0.92))}px "Avenir Next", sans-serif`;
    this.ctx.textAlign = "center";
    this.ctx.textBaseline = "middle";
    this.ctx.fillText(initials, item.x, item.y + 0.5);
    this.ctx.restore();
  }

  drawLabel(item) {
    const label = trimLabel(item.node.full_name || item.node.node_id, item.node.is_seed ? 24 : 18);
    this.ctx.save();
    this.ctx.font = item.node.is_seed ? "600 12px 'Avenir Next', sans-serif" : "500 11px 'Avenir Next', sans-serif";
    this.ctx.fillStyle = "rgba(20, 33, 43, 0.88)";
    this.ctx.textAlign = "center";
    this.ctx.fillText(label, item.x, item.y - item.radius - 10);
    this.ctx.restore();
  }

  buildLayout(result) {
    const rect = this.canvas.getBoundingClientRect();
    const width = Math.max(640, rect.width || 640);
    const height = Math.max(480, rect.height || 480);
    const centerX = width / 2;
    const centerY = height / 2;
    const seedNodes = result.nodes.filter((node) => node.is_seed);
    const nonSeedNodes = result.nodes
      .filter((node) => !node.is_seed)
      .sort((left, right) => right.shared_seed_count - left.shared_seed_count);
    const sizeFactor = result.nodes.length > 260 ? 0.8 : result.nodes.length > 150 ? 0.9 : 1;

    const seedPositionsByIndex = new Map();
    const nodeLayout = [];
    const seedRadiusOrbit = Math.min(width, height) * (seedNodes.length === 1 ? 0.22 : 0.34);
    const seedNodeRadius = Math.max(17, 21 * sizeFactor);
    const sharedNodeRadius = Math.max(9, 11 * sizeFactor);
    const singleNodeRadius = Math.max(7, 8.5 * sizeFactor);

    seedNodes.forEach((node, idx) => {
      const angle = (-Math.PI / 2) + (idx / Math.max(seedNodes.length, 1)) * Math.PI * 2;
      const targetX = centerX + Math.cos(angle) * seedRadiusOrbit;
      const targetY = centerY + Math.sin(angle) * seedRadiusOrbit * 0.76;
      seedPositionsByIndex.set(node.seed_indices[0], { x: targetX, y: targetY });
      nodeLayout.push({
        node,
        startX: centerX,
        startY: centerY,
        targetX,
        targetY,
        radius: seedNodeRadius,
      });
    });

    nonSeedNodes.forEach((node, idx) => {
      const anchors = node.connected_seed_indices
        .map((seedIndex) => seedPositionsByIndex.get(seedIndex))
        .filter(Boolean);

      let targetX = centerX;
      let targetY = centerY;
      if (anchors.length) {
        targetX = average(anchors.map((anchor) => anchor.x));
        targetY = average(anchors.map((anchor) => anchor.y));
      }

      const hashAngle = ((hashString(node.node_id) % 360) * Math.PI) / 180;
      const orbit = anchors.length > 1
        ? (38 + node.shared_seed_count * 18) * sizeFactor
        : (112 + (idx % 10) * 14) * sizeFactor;
      const spreadX = Math.cos(hashAngle) * orbit;
      const spreadY = Math.sin(hashAngle) * orbit * 0.72;
      const radius = node.shared_seed_count >= 2 ? sharedNodeRadius : singleNodeRadius;
      const margin = radius + 18;

      nodeLayout.push({
        node,
        startX: centerX + Math.cos(hashAngle) * 18,
        startY: centerY + Math.sin(hashAngle) * 18,
        targetX: clamp(targetX + spreadX, margin, width - margin),
        targetY: clamp(targetY + spreadY, margin, height - margin),
        radius,
      });
    });

    return nodeLayout;
  }

  onPointerMove(event) {
    if (!this.currentPositions || !this.currentPositions.size) {
      return;
    }

    const rect = this.canvas.getBoundingClientRect();
    const pointerX = event.clientX - rect.left;
    const pointerY = event.clientY - rect.top;
    let hovered = null;
    const hoverOrder = [...this.currentPositions.values()].sort((left, right) => {
      if (left.node.is_seed !== right.node.is_seed) {
        return left.node.is_seed ? -1 : 1;
      }
      return right.radius - left.radius;
    });

    for (const item of hoverOrder) {
      const distance = Math.hypot(pointerX - item.x, pointerY - item.y);
      if (distance <= item.radius + 5) {
        hovered = item;
        break;
      }
    }

    if (!hovered) {
      this.tooltip.hidden = true;
      return;
    }

    const relationshipLabel = hovered.node.is_seed
      ? `Исходный профиль #${(hovered.node.seed_indices[0] || 0) + 1}`
      : hovered.node.connected_seed_indices.length > 1
        ? `Общий друг профилей ${hovered.node.connected_seed_indices.map((index) => `#${index + 1}`).join(", ")}`
        : `Друг профиля #${(hovered.node.connected_seed_indices[0] || 0) + 1}`;

    this.tooltip.innerHTML = `
      <strong>${escapeTooltip(hovered.node.full_name)}</strong><br>
      <span>${escapeTooltip(relationshipLabel)}</span>
    `;
    this.tooltip.style.left = `${pointerX}px`;
    this.tooltip.style.top = `${pointerY}px`;
    this.tooltip.hidden = false;
  }
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
