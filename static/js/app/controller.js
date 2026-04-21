import { createDomRefs, readPageConfig } from "./dom.js";
import { buildIntersectionGroups } from "./intersections.js";
import { renderOverlaps, renderSeedProfiles, updateActiveCards } from "./panels.js";
import { SocialGraphApiClient } from "./social-graph-api.js";
import {
  applyTheme,
  getNextTheme,
  getThemeToggleLabel,
  persistTheme,
  resolveInitialTheme,
} from "./theme.js";
import { GraphRenderer } from "../graph/renderer.js";

const ALL_SHARED_FOCUS_KEY = "shared:all";

export class GraphOfGodApp {
  constructor(documentRef) {
    this.document = documentRef;
    this.window = documentRef.defaultView;
    this.dom = createDomRefs(documentRef);
    this.config = readPageConfig(this.dom.body);
    this.api = new SocialGraphApiClient();
    this.renderer = new GraphRenderer(this.dom.canvas, this.dom.tooltip);
    this.currentTheme = resolveInitialTheme(this.window, this.dom.rootElement);
    this.state = {
      pollHandle: null,
      latestJobId: null,
      result: null,
      intersectionGroups: [],
      focusKey: null,
      focusLabel: null,
    };
  }

  boot() {
    this.setTheme(this.currentTheme, { persist: false });
    this.addProfileRow("https://vk.com/durov");
    this.addProfileRow("");

    this.dom.addProfileButton.addEventListener("click", () => this.handleAddProfile());
    this.dom.fullscreenButton.addEventListener("click", () => this.toggleFullscreen());
    this.dom.themeToggleButton.addEventListener("click", () => this.toggleTheme());
    this.dom.highlightAllButton.addEventListener("click", () => this.toggleAllSharedFocus());
    this.dom.resetViewButton.addEventListener("click", () => this.renderer.resetView());
    this.dom.form.addEventListener("submit", (event) => this.onSubmit(event));
    window.addEventListener("resize", () => this.renderer.handleResize());
    this.document.addEventListener("fullscreenchange", () => this.handleFullscreenChange());
    this.renderer.setViewportListener((viewportState) => this.updateViewportUi(viewportState));
    this.renderer.setNodeActivateListener((node) => this.openNodeProfile(node));

    this.updateProfileControls();
    this.updateFocusUi();
    this.updateFullscreenUi();
    this.updateThemeUi();
  }

  handleAddProfile() {
    if (this.dom.profilesList.children.length >= this.config.maxProfiles) {
      this.setStatus("Лимит достигнут", `Можно добавить не больше ${this.config.maxProfiles} профилей.`, "error");
      return;
    }

    this.addProfileRow("");
    this.updateProfileControls();
  }

  addProfileRow(value) {
    const row = this.document.createElement("div");
    row.className = "profile-row";

    const index = this.document.createElement("span");
    index.className = "profile-index";

    const input = this.document.createElement("input");
    input.className = "profile-input";
    input.type = "text";
    input.placeholder = "https://vk.com/durov или screen_name";
    input.value = value;

    const removeButton = this.document.createElement("button");
    removeButton.type = "button";
    removeButton.className = "icon-button";
    removeButton.textContent = "×";
    removeButton.title = "Удалить профиль";
    removeButton.addEventListener("click", () => {
      row.remove();
      this.updateProfileControls();
    });

    row.append(index, input, removeButton);
    this.dom.profilesList.appendChild(row);
    this.updateProfileControls();
  }

  updateProfileControls() {
    [...this.dom.profilesList.children].forEach((row, idx) => {
      row.querySelector(".profile-index").textContent = String(idx + 1);
      row.querySelector(".icon-button").disabled = this.dom.profilesList.children.length <= 1;
    });
    this.dom.addProfileButton.disabled = this.dom.profilesList.children.length >= this.config.maxProfiles;
  }

  async onSubmit(event) {
    event.preventDefault();

    const profiles = [...this.dom.profilesList.querySelectorAll(".profile-input")]
      .map((input) => input.value.trim())
      .filter(Boolean);

    if (!profiles.length) {
      this.setStatus("Нет профилей", "Добавьте хотя бы один профиль VK.", "error");
      return;
    }

    if (new Set(profiles).size !== profiles.length) {
      this.setStatus("Дубликаты профилей", "Повторяющиеся профили лучше убрать ещё на фронтенде.", "error");
      return;
    }

    this.stopPolling();
    this.clearGraph();
    this.setLoadingState(true);
    this.setStatus("Запускаю задачу", "Frontend отправляет выбранные профили в backend и ждёт job id.", "loading");

    try {
      const payload = await this.api.createJob(profiles);
      this.state.latestJobId = payload.job_id;
      this.setStatus(
        "Задача запущена",
        `Job ${payload.job_id.slice(0, 8)}... создан. Жду готовый social graph из backend.`,
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
            payload.status === "queued" ? "Задача в очереди" : "Backend строит граф",
            "Продолжаю опрашивать статус. Это может занять время для профилей с большим числом связей.",
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
        this.setStatus("Граф готов", "Загрузка завершена. Можно изучать связи и общих друзей на графе ниже.", "success");
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
    this.dom.addProfileButton.disabled = isLoading || this.dom.profilesList.children.length >= this.config.maxProfiles;
    this.dom.highlightAllButton.disabled = isLoading;
    this.dom.resetViewButton.disabled = isLoading;

    [...this.dom.profilesList.querySelectorAll(".profile-input, .icon-button")].forEach((element) => {
      element.disabled = isLoading;
    });
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
    this.state.result = null;
    this.state.intersectionGroups = [];
    this.state.focusKey = null;
    this.state.focusLabel = null;
    this.dom.emptyState.hidden = false;
    this.renderer.clear();
    this.dom.seedProfilesList.innerHTML = "";
    this.dom.overlapsList.innerHTML = "";
    this.dom.seedCountElement.textContent = "0";
    this.dom.nodeCountElement.textContent = "0";
    this.dom.sharedCountElement.textContent = "0";
    this.updateFocusUi();
  }

  renderResult(result) {
    this.state.result = result;
    this.state.intersectionGroups = buildIntersectionGroups(result);
    this.dom.emptyState.hidden = true;
    this.dom.seedCountElement.textContent = String(result.stats.seed_count);
    this.dom.nodeCountElement.textContent = String(result.stats.node_count);
    this.dom.sharedCountElement.textContent = String(result.stats.shared_node_count);

    renderSeedProfiles({
      container: this.dom.seedProfilesList,
      seedProfiles: result.seed_profiles,
      activeFocusKey: this.state.focusKey,
      onToggleSeedFocus: (seedIndex) => this.toggleSeedFocus(seedIndex),
    });

    renderOverlaps({
      container: this.dom.overlapsList,
      groups: this.state.intersectionGroups,
      activeFocusKey: this.state.focusKey,
      onToggleIntersectionFocus: (group) => this.toggleIntersectionFocus(group),
    });

    this.renderer.setData(result);
    this.applyFocus(null);
  }

  toggleSeedFocus(seedIndex) {
    const focusKey = `seed:${seedIndex}`;
    if (this.state.focusKey === focusKey) {
      this.applyFocus(null);
      return;
    }

    const profile = this.state.result?.seed_profiles.find((item) => item.seed_index === seedIndex);
    if (!profile || !this.state.result) {
      return;
    }

    const selectedNodeIds = new Set([profile.node_id]);
    this.state.result.nodes.forEach((node) => {
      if (node.node_id === profile.node_id || node.connected_seed_indices.includes(seedIndex)) {
        selectedNodeIds.add(node.node_id);
      }
    });

    this.applyFocus({
      key: focusKey,
      label: `Профиль #${seedIndex + 1}: ${profile.full_name}`,
      seedIndices: [seedIndex],
      nodeIds: [...selectedNodeIds],
    });
  }

  toggleIntersectionFocus(group) {
    if (this.state.focusKey === group.key) {
      this.applyFocus(null);
      return;
    }

    if (!this.state.result) {
      return;
    }

    const selectedNodeIds = new Set(group.nodeIds);
    group.seedIndices.forEach((seedIndex) => {
      const seedProfile = this.state.result.seed_profiles.find((item) => item.seed_index === seedIndex);
      if (seedProfile) {
        selectedNodeIds.add(seedProfile.node_id);
      }
    });

    this.applyFocus({
      key: group.key,
      label: `${group.title}: ${group.sharedCount} общих друзей`,
      seedIndices: group.seedIndices,
      nodeIds: [...selectedNodeIds],
    });
  }

  toggleAllSharedFocus() {
    if (!this.state.result) {
      return;
    }

    if (this.state.focusKey === ALL_SHARED_FOCUS_KEY) {
      this.applyFocus(null);
      return;
    }

    const selectedNodeIds = new Set();
    const activeSeedIndices = new Set();

    this.state.result.nodes.forEach((node) => {
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

    this.state.result.seed_profiles.forEach((profile) => {
      if (activeSeedIndices.has(profile.seed_index)) {
        selectedNodeIds.add(profile.node_id);
      }
    });

    this.applyFocus({
      key: ALL_SHARED_FOCUS_KEY,
      label: `Все общие связи: ${this.state.result.stats.shared_node_count} общих друзей`,
      seedIndices: [...activeSeedIndices].sort((left, right) => left - right),
      nodeIds: [...selectedNodeIds],
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
    this.updateHighlightAllButton();
  }

  updateViewportUi(viewportState) {
    const hasData = Boolean(viewportState?.hasData);
    this.dom.zoomLevel.hidden = !hasData;
    this.dom.resetViewButton.hidden = !hasData;
    this.dom.zoomLevel.textContent = `${Math.round((viewportState?.scale || 1) * 100)}%`;
    this.dom.resetViewButton.disabled = !hasData || !viewportState?.canReset;
  }

  updateHighlightAllButton() {
    const hasData = Boolean(this.state.result);
    const hasSharedNodes = (this.state.result?.stats?.shared_node_count || 0) > 0;
    const isActive = this.state.focusKey === ALL_SHARED_FOCUS_KEY;

    this.dom.highlightAllButton.hidden = !hasData;
    this.dom.highlightAllButton.disabled = !hasData || !hasSharedNodes;
    this.dom.highlightAllButton.textContent = isActive ? "Снять подсветку" : "Подсветить все связи";
  }

  openNodeProfile(node) {
    if (!node?.profile_url) {
      return;
    }

    this.window.open(node.profile_url, "_blank", "noopener,noreferrer");
  }

  toggleTheme() {
    this.setTheme(getNextTheme(this.currentTheme));
  }

  setTheme(theme, options = {}) {
    const { persist = true } = options;
    this.currentTheme = theme;
    applyTheme(this.dom.rootElement, theme);
    if (persist) {
      persistTheme(theme);
    }
    this.updateThemeUi();
    this.renderer.requestRender();
  }

  updateThemeUi() {
    const isDark = this.currentTheme === "dark";
    this.dom.themeToggleButton.textContent = getThemeToggleLabel(this.currentTheme);
    this.dom.themeToggleButton.setAttribute("aria-pressed", String(isDark));
    this.dom.themeToggleButton.setAttribute("title", this.dom.themeToggleButton.textContent);
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
