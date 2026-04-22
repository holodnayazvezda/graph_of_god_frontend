import { updateActiveCards } from "../app/panels.js";
import { THEME_CHANGE_EVENT } from "../app/theme.js";
import { GraphRenderer } from "../graph/renderer.js";
import { DeepFriendAnalysisApiClient } from "./api.js";
import { createDomRefs, readPageConfig } from "./dom.js";
import { renderCycles, renderRootProfile } from "./panels.js";

const ALL_CYCLES_FOCUS_KEY = "cycles:all";
const NODE_RELATED_FOCUS_KEY_PREFIX = "node-related:";
const ROOT_FOCUS_KEY = "root";

export class DeepFriendAnalysisApp {
  constructor(documentRef) {
    this.document = documentRef;
    this.dom = createDomRefs(documentRef);
    this.config = readPageConfig(this.dom.body);
    this.api = new DeepFriendAnalysisApiClient();
    this.renderer = new GraphRenderer(this.dom.canvas, this.dom.tooltip);
    this.state = {
      pollHandle: null,
      latestJobId: null,
      rawResult: null,
      result: null,
      focusKey: null,
      focusLabel: null,
      directFriendsOnly: false,
      cyclesSectionCollapsed: true,
    };
  }

  boot() {
    this.dom.profileInput.value = "https://vk.com/durov";
    this.dom.depthInput.value = String(Math.min(2, this.config.maxDepth));

    this.dom.form.addEventListener("submit", (event) => this.onSubmit(event));
    this.dom.fullscreenButton.addEventListener("click", () => this.toggleFullscreen());
    this.dom.highlightCyclesButton.addEventListener("click", () => this.toggleAllCyclesFocus());
    this.dom.directFriendsButton.addEventListener("click", () => this.toggleDirectFriendsOnly());
    this.dom.cyclesToggleButton.addEventListener("click", () => this.toggleCyclesSection());
    this.dom.resetViewButton.addEventListener("click", () => this.renderer.resetView());
    window.addEventListener("resize", () => this.renderer.handleResize());
    this.document.addEventListener("fullscreenchange", () => this.handleFullscreenChange());
    window.addEventListener(THEME_CHANGE_EVENT, () => this.renderer.requestRender());
    this.renderer.setViewportListener((viewportState) => this.updateViewportUi(viewportState));
    this.renderer.setNodeTooltipBuilder((node, descriptor) => this.buildNodeTooltip(node, descriptor));

    this.clearGraph();
    this.updateFullscreenUi();
  }

  async onSubmit(event) {
    event.preventDefault();

    const profile = this.dom.profileInput.value.trim();
    const depth = Number(this.dom.depthInput.value);

    if (!profile) {
      this.setStatus("Нет профиля", "Укажи ссылку VK или username для глубокого анализа.", "error");
      return;
    }

    if (!Number.isInteger(depth) || depth <= 0) {
      this.setStatus("Некорректная глубина", "Глубина анализа должна быть целым числом больше нуля.", "error");
      return;
    }

    if (depth > this.config.maxDepth) {
      this.setStatus(
        "Слишком большая глубина",
        `В текущей конфигурации доступна глубина не больше ${this.config.maxDepth}.`,
        "error",
      );
      return;
    }

    this.stopPolling();
    this.clearGraph();
    this.setLoadingState(true);
    this.setStatus(
      "Запускаю анализ",
      "Frontend отправляет профиль и глубину в backend. Дальше начнётся обход друзей и поиск циклов.",
      "loading",
    );

    try {
      const payload = await this.api.createJob(profile, depth);
      this.state.latestJobId = payload.job_id;
      this.setStatus(
        "Задача запущена",
        `Job ${payload.job_id.slice(0, 8)}... создан. Жду результат глубокого анализа друзей.`,
        "loading",
      );
      await this.pollJob(payload.status_url);
    } catch (error) {
      this.setLoadingState(false);
      this.setStatus("Ошибка запуска", error.message, "error");
    }
  }

  async pollJob(statusUrl) {
    this.stopPolling();

    const tick = async () => {
      try {
        const payload = await this.api.getJob(statusUrl);

        if (payload.status === "queued" || payload.status === "running") {
          this.setStatus(
            payload.status === "queued" ? "Задача в очереди" : "Идёт глубокий обход друзей",
            "Backend проходит друзей по уровням глубины и собирает циклы в доступной сети друзей.",
            "loading",
          );
          this.state.pollHandle = window.setTimeout(tick, this.config.pollIntervalMs);
          return;
        }

        this.setLoadingState(false);

        if (payload.status === "failed") {
          this.setStatus("Задача завершилась ошибкой", payload.error_message || "Неизвестная ошибка backend.", "error");
          return;
        }

        if (!payload.result) {
          this.setStatus("Пустой ответ", "Backend вернул успешный статус, но без результата.", "error");
          return;
        }

        this.renderResult(payload.result);
      } catch (error) {
        this.setLoadingState(false);
        this.setStatus("Ошибка polling", error.message, "error");
      }
    };

    await tick();
  }

  stopPolling() {
    if (this.state.pollHandle !== null) {
      window.clearTimeout(this.state.pollHandle);
      this.state.pollHandle = null;
    }
  }

  setLoadingState(isLoading) {
    this.dom.submitButton.disabled = isLoading;
    this.dom.profileInput.disabled = isLoading;
    this.dom.depthInput.disabled = isLoading;
    this.dom.highlightCyclesButton.disabled = isLoading;
    this.dom.directFriendsButton.disabled = isLoading;
    this.dom.resetViewButton.disabled = isLoading;
  }

  setStatus(title, text, kind) {
    this.dom.statusPanel.classList.remove("is-loading", "is-success", "is-error");
    if (kind === "loading") {
      this.dom.statusPanel.classList.add("is-loading");
    } else if (kind === "success") {
      this.dom.statusPanel.classList.add("is-success");
    } else if (kind === "error") {
      this.dom.statusPanel.classList.add("is-error");
    }

    this.dom.statusTitle.textContent = title;
    this.dom.statusText.textContent = text;
  }

  clearGraph() {
    this.state.rawResult = null;
    this.state.result = null;
    this.state.focusKey = null;
    this.state.focusLabel = null;
    this.state.cyclesSectionCollapsed = true;
    this.dom.emptyState.hidden = false;
    this.renderer.clear();
    this.dom.rootProfileContainer.innerHTML = "";
    this.dom.cyclesList.innerHTML = "";
    this.dom.requestedDepthMetric.textContent = "0";
    this.dom.cycleCountMetric.textContent = "0";
    this.dom.renderedNodeCountMetric.textContent = "0";
    this.setStatus(
      "Ожидание запроса",
      "Задай профиль VK и глубину, после чего backend начнёт искать циклы в доступной сети друзей.",
      "success",
    );
    this.updateFocusUi();
    this.updateHighlightCyclesButton();
    this.updateDirectFriendsButton();
    this.updateCyclesSectionUi();
  }

  renderResult(rawResult) {
    this.state.rawResult = rawResult;
    const result = this.buildDisplayedResult(rawResult);
    this.state.result = result;
    this.dom.emptyState.hidden = true;
    this.dom.requestedDepthMetric.textContent = String(result.stats.requested_depth);
    this.dom.cycleCountMetric.textContent = String(result.stats.cycle_count);
    this.dom.renderedNodeCountMetric.textContent = String(result.stats.rendered_node_count);

    renderRootProfile({
      container: this.dom.rootProfileContainer,
      rootProfile: result.root_profile,
      stats: result.stats,
      activeFocusKey: this.state.focusKey,
      onToggleRootFocus: () => this.toggleRootFocus(),
    });

    renderCycles({
      container: this.dom.cyclesList,
      cycles: result.cycles,
      nodes: result.nodes,
      activeFocusKey: this.state.focusKey,
      onToggleCycleFocus: (cycle) => this.toggleCycleFocus(cycle),
    });

    this.renderer.setData(result);
    this.applyFocus(null);
    this.updateResultStatus(result);
    this.updateDirectFriendsButton();
    this.updateCyclesSectionUi();
  }

  updateResultStatus(result) {
    const hasFilteredDirectFriends = this.state.directFriendsOnly;
    const rawCycleCount = this.state.rawResult?.cycles?.length || 0;

    if (result.root_profile.is_private) {
      this.setStatus(
        "Профиль закрыт",
        "Корневой профиль оказался закрытым, поэтому глубокий анализ друзей недоступен.",
        "error",
      );
      return;
    }

    if (!result.cycles.length) {
      if (hasFilteredDirectFriends && rawCycleCount > 0) {
        this.setStatus(
          "Показаны только прямые друзья",
          "После фильтра на графе остались только прямые друзья, у которых есть общие связи или замкнутые циклы. Среди них циклов не осталось.",
          "success",
        );
        return;
      }

      this.setStatus(
        "Циклы не найдены",
        "В доступной глубине не удалось обнаружить циклы. На графе оставлен только корневой профиль для ориентира.",
        "success",
      );
      return;
    }

    const limitationMessage = result.stats.exploration_was_limited || result.stats.truncated_profile_count > 0
      ? " Результат частично ограничен лимитами исследования."
      : "";

    this.setStatus(
      hasFilteredDirectFriends ? "Показаны только прямые друзья" : "Циклы найдены",
      hasFilteredDirectFriends
        ? `На графе оставлены только друзья первого уровня, у которых есть общие связи или циклы. После фильтра видны ${result.stats.cycle_count} циклов.${limitationMessage}`
        : `Backend нашёл ${result.stats.cycle_count} циклов и отрисовал связанные с ними ветки.${limitationMessage}`,
      "success",
    );
  }

  toggleRootFocus() {
    if (!this.state.result) {
      return;
    }

    if (this.state.focusKey === ROOT_FOCUS_KEY) {
      this.applyFocus(null);
      return;
    }

    this.applyFocus({
      key: ROOT_FOCUS_KEY,
      label: `Корневой профиль: ${this.state.result.root_profile.full_name}`,
      nodeIds: [this.state.result.root_profile.node_id],
    });
  }

  toggleCycleFocus(cycle) {
    const focusKey = `cycle:${cycle.cycle_id}`;
    if (this.state.focusKey === focusKey) {
      this.applyFocus(null);
      return;
    }

    this.applyFocus({
      key: focusKey,
      label: `Цикл #${cycle.cycle_id.replace("cycle:", "")}: длина ${cycle.length}`,
      nodeIds: cycle.focus_node_ids,
    });
  }

  toggleAllCyclesFocus() {
    if (!this.state.result || !this.state.result.cycles.length) {
      return;
    }

    if (this.state.focusKey === ALL_CYCLES_FOCUS_KEY) {
      this.applyFocus(null);
      return;
    }

    const nodeIds = new Set();
    this.state.result.cycles.forEach((cycle) => {
      cycle.focus_node_ids.forEach((nodeId) => nodeIds.add(nodeId));
    });
    nodeIds.add(this.state.result.root_profile.node_id);

    this.applyFocus({
      key: ALL_CYCLES_FOCUS_KEY,
      label: `Все найденные циклы: ${this.state.result.cycles.length}`,
      nodeIds: [...nodeIds],
    });
  }

  applyFocus(focus) {
    this.state.focusKey = focus?.key || null;
    this.state.focusLabel = focus?.label || null;
    this.renderer.setFocus(focus);
    this.updateFocusUi();
    updateActiveCards(this.document, this.state.focusKey);
  }

  updateFocusUi() {
    this.dom.focusState.hidden = !this.state.focusLabel;
    this.dom.focusState.textContent = this.state.focusLabel || "";
    this.updateHighlightCyclesButton();
  }

  updateHighlightCyclesButton() {
    const hasCycles = (this.state.result?.cycles?.length || 0) > 0;
    const isActive = this.state.focusKey === ALL_CYCLES_FOCUS_KEY;

    this.dom.highlightCyclesButton.hidden = !this.state.result;
    this.dom.highlightCyclesButton.disabled = !hasCycles;
    this.dom.highlightCyclesButton.textContent = isActive ? "Снять подсветку" : "Подсветить все циклы";
  }

  updateDirectFriendsButton() {
    const hasResult = Boolean(this.state.rawResult);
    this.dom.directFriendsButton.hidden = !hasResult;
    this.dom.directFriendsButton.disabled = !hasResult;
    this.dom.directFriendsButton.textContent = this.state.directFriendsOnly ? "Показать всех" : "Убрать не-друзей";
  }

  toggleDirectFriendsOnly() {
    if (!this.state.rawResult) {
      return;
    }

    this.state.directFriendsOnly = !this.state.directFriendsOnly;
    this.renderResult(this.state.rawResult);
  }

  toggleCyclesSection() {
    this.state.cyclesSectionCollapsed = !this.state.cyclesSectionCollapsed;
    this.updateCyclesSectionUi();
  }

  updateCyclesSectionUi() {
    const isCollapsed = this.state.cyclesSectionCollapsed;
    this.dom.cyclesSectionBody.hidden = isCollapsed;
    this.dom.cyclesToggleButton.textContent = isCollapsed ? "Развернуть" : "Свернуть";
    this.dom.cyclesToggleButton.setAttribute("aria-expanded", String(!isCollapsed));
  }

  buildDisplayedResult(rawResult) {
    if (!this.state.directFriendsOnly) {
      return this.pruneOpenBranches(rawResult, rawResult.nodes, rawResult.edges, rawResult.cycles);
    }

    const rootNodeId = rawResult.root_profile.node_id;
    const firstLevelNodes = rawResult.nodes.filter((node) => node.distance_from_root === 1);
    const candidateNodeIds = new Set([rootNodeId, ...firstLevelNodes.map((node) => node.node_id)]);

    const candidateEdges = rawResult.edges.filter(
      (edge) => candidateNodeIds.has(edge.source_node_id) && candidateNodeIds.has(edge.target_node_id),
    );

    const directFriendNeighborCount = new Map(firstLevelNodes.map((node) => [node.node_id, 0]));
    candidateEdges.forEach((edge) => {
      if (edge.source_node_id === rootNodeId || edge.target_node_id === rootNodeId) {
        return;
      }

      directFriendNeighborCount.set(
        edge.source_node_id,
        (directFriendNeighborCount.get(edge.source_node_id) || 0) + 1,
      );
      directFriendNeighborCount.set(
        edge.target_node_id,
        (directFriendNeighborCount.get(edge.target_node_id) || 0) + 1,
      );
    });

    const candidateCycles = rawResult.cycles.filter((cycle) =>
      cycle.node_ids.every((nodeId) => candidateNodeIds.has(nodeId)),
    );
    const cycleRelatedNodeIds = new Set();
    candidateCycles.forEach((cycle) => {
      cycle.node_ids.forEach((nodeId) => cycleRelatedNodeIds.add(nodeId));
      cycle.focus_node_ids.forEach((nodeId) => {
        if (candidateNodeIds.has(nodeId)) {
          cycleRelatedNodeIds.add(nodeId);
        }
      });
    });

    const keptNodeIds = new Set([rootNodeId]);
    firstLevelNodes.forEach((node) => {
      const hasMutualFriend = (directFriendNeighborCount.get(node.node_id) || 0) > 0;
      const belongsToCycle = cycleRelatedNodeIds.has(node.node_id);
      if (hasMutualFriend || belongsToCycle) {
        keptNodeIds.add(node.node_id);
      }
    });

    const nodes = rawResult.nodes.filter((node) => keptNodeIds.has(node.node_id));
    const edges = candidateEdges.filter(
      (edge) => keptNodeIds.has(edge.source_node_id) && keptNodeIds.has(edge.target_node_id),
    );
    const cycles = candidateCycles
      .filter((cycle) => cycle.node_ids.every((nodeId) => keptNodeIds.has(nodeId)))
      .map((cycle) => ({
        ...cycle,
        focus_node_ids: cycle.focus_node_ids.filter((nodeId) => keptNodeIds.has(nodeId)),
      }))
      .filter((cycle) => cycle.node_ids.length > 1);

    return this.pruneOpenBranches(rawResult, nodes, edges, cycles);
  }

  pruneOpenBranches(rawResult, nodes, edges, cycles) {
    const rootNodeId = rawResult.root_profile.node_id;
    const keptNodeIds = new Set(nodes.map((node) => node.node_id));
    keptNodeIds.add(rootNodeId);
    const cycleNodeIds = new Set(cycles.flatMap((cycle) => cycle.node_ids));

    let hasChanges = true;
    while (hasChanges) {
      hasChanges = false;
      const degreeByNodeId = new Map([...keptNodeIds].map((nodeId) => [nodeId, 0]));

      edges.forEach((edge) => {
        if (!keptNodeIds.has(edge.source_node_id) || !keptNodeIds.has(edge.target_node_id)) {
          return;
        }

        degreeByNodeId.set(edge.source_node_id, (degreeByNodeId.get(edge.source_node_id) || 0) + 1);
        degreeByNodeId.set(edge.target_node_id, (degreeByNodeId.get(edge.target_node_id) || 0) + 1);
      });

      nodes.forEach((node) => {
        if (
          !keptNodeIds.has(node.node_id)
          || node.node_id === rootNodeId
          || cycleNodeIds.has(node.node_id)
        ) {
          return;
        }

        if ((degreeByNodeId.get(node.node_id) || 0) <= 1) {
          keptNodeIds.delete(node.node_id);
          hasChanges = true;
        }
      });
    }

    const filteredEdges = edges.filter(
      (edge) => keptNodeIds.has(edge.source_node_id) && keptNodeIds.has(edge.target_node_id),
    );
    const keptEdgeIds = new Set(filteredEdges.map((edge) => edge.edge_id));
    const filteredCycles = cycles
      .filter((cycle) => cycle.node_ids.every((nodeId) => keptNodeIds.has(nodeId)))
      .map((cycle) => ({
        ...cycle,
        edge_ids: cycle.edge_ids.filter((edgeId) => keptEdgeIds.has(edgeId)),
        focus_node_ids: cycle.focus_node_ids.filter((nodeId) => keptNodeIds.has(nodeId)),
      }))
      .filter((cycle) => cycle.node_ids.length > 1 && cycle.edge_ids.length > 0);

    const cycleCountByNodeId = new Map();
    const cycleEdgeIds = new Set();
    filteredCycles.forEach((cycle) => {
      cycle.node_ids.forEach((nodeId) => {
        cycleCountByNodeId.set(nodeId, (cycleCountByNodeId.get(nodeId) || 0) + 1);
      });
      cycle.edge_ids.forEach((edgeId) => cycleEdgeIds.add(edgeId));
    });

    const filteredNodes = nodes
      .filter((node) => keptNodeIds.has(node.node_id))
      .map((node) => {
        const cycleCount = cycleCountByNodeId.get(node.node_id) || 0;
        return {
          ...node,
          shared_seed_count: node.is_seed ? node.shared_seed_count : cycleCount > 0 ? 2 : 1,
          is_cycle_member: cycleCount > 0,
          cycle_count: cycleCount,
        };
      });

    return {
      ...rawResult,
      nodes: filteredNodes,
      edges: filteredEdges,
      cycles: filteredCycles,
      stats: {
        ...rawResult.stats,
        rendered_node_count: filteredNodes.length,
        rendered_edge_count: filteredEdges.length,
        cycle_count: filteredCycles.length,
        cycle_node_count: filteredNodes.filter((node) => node.is_cycle_member).length,
        cycle_edge_count: filteredEdges.filter((edge) => cycleEdgeIds.has(edge.edge_id)).length,
      },
    };
  }

  buildNodeTooltip(node, descriptor) {
    if (!this.state.result) {
      return descriptor;
    }

    const isNodeRelatedFocusActive = this.state.focusKey === this.buildNodeRelatedFocusKey(node.node_id);
    const actions = [
      ...(node.profile_url
        ? [
            {
              shortcut: "o",
              label: "Открыть VK",
              onSelect: () => this.openNodeProfile(node),
            },
          ]
        : []),
      {
        shortcut: "p",
        label: isNodeRelatedFocusActive ? "Снять подсветку" : "Подсветить циклы и связи",
        onSelect: () => this.toggleNodeRelatedFocus(node),
      },
    ];

    return {
      ...descriptor,
      actions,
    };
  }

  buildNodeRelatedFocusKey(nodeId) {
    return `${NODE_RELATED_FOCUS_KEY_PREFIX}${nodeId}`;
  }

  toggleNodeRelatedFocus(node) {
    if (!this.state.result) {
      return;
    }

    const focusKey = this.buildNodeRelatedFocusKey(node.node_id);
    if (this.state.focusKey === focusKey) {
      this.applyFocus(null);
      return;
    }

    const relatedFocus = this.collectNodeRelatedFocus(node.node_id);
    this.applyFocus({
      key: focusKey,
      label: `${node.full_name}: циклы ${relatedFocus.relatedCycleCount}, прямые связи ${relatedFocus.relatedNeighborCount}`,
      nodeIds: [...relatedFocus.nodeIds],
    });
  }

  collectNodeRelatedFocus(nodeId) {
    const nodeIds = new Set([nodeId]);
    const neighborNodeIds = new Set();
    const relatedCycles = [];

    this.state.result.edges.forEach((edge) => {
      if (edge.source_node_id === nodeId) {
        neighborNodeIds.add(edge.target_node_id);
        nodeIds.add(edge.target_node_id);
      } else if (edge.target_node_id === nodeId) {
        neighborNodeIds.add(edge.source_node_id);
        nodeIds.add(edge.source_node_id);
      }
    });

    this.state.result.cycles.forEach((cycle) => {
      if (!cycle.node_ids.includes(nodeId) && !cycle.focus_node_ids.includes(nodeId)) {
        return;
      }

      relatedCycles.push(cycle);
      cycle.focus_node_ids.forEach((focusNodeId) => nodeIds.add(focusNodeId));
    });

    return {
      nodeIds,
      relatedCycleCount: relatedCycles.length,
      relatedNeighborCount: neighborNodeIds.size,
    };
  }

  updateViewportUi(viewportState) {
    const hasData = Boolean(viewportState?.hasData);
    this.dom.zoomLevel.hidden = !hasData;
    this.dom.resetViewButton.hidden = !hasData;
    this.dom.zoomLevel.textContent = `${Math.round((viewportState?.scale || 1) * 100)}%`;
    this.dom.resetViewButton.disabled = !hasData || !viewportState?.canReset;
  }

  openNodeProfile(node) {
    if (!node?.profile_url) {
      return;
    }

    window.open(node.profile_url, "_blank", "noopener,noreferrer");
  }

  async toggleFullscreen() {
    if (!this.document.fullscreenEnabled) {
      return;
    }

    try {
      if (this.isGraphFullscreen()) {
        await this.document.exitFullscreen();
        return;
      }

      await this.dom.graphStage.requestFullscreen();
    } catch (error) {
      this.setStatus("Ошибка fullscreen", error.message || "Не удалось переключить полноэкранный режим.", "error");
    }
  }

  handleFullscreenChange() {
    this.updateFullscreenUi();
    this.renderer.handleResize();
  }

  updateFullscreenUi() {
    const isSupported = Boolean(this.document.fullscreenEnabled);
    const isActive = this.isGraphFullscreen();

    this.dom.fullscreenButton.hidden = !isSupported;
    this.dom.fullscreenButton.textContent = isActive ? "Выйти из full screen" : "Во весь экран";
    this.dom.graphStage.classList.toggle("is-fullscreen", isActive);
  }

  isGraphFullscreen() {
    return this.document.fullscreenElement === this.dom.graphStage;
  }
}
