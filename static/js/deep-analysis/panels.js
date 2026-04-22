import { updateActiveCards } from "../app/panels.js";
import { escapeHtml } from "../app/utils.js";

export function renderRootProfile({
  container,
  rootProfile,
  stats,
  activeFocusKey,
  onToggleRootFocus,
}) {
  container.innerHTML = "";

  const card = document.createElement("article");
  card.className = "seed-card deep-analysis-root-card";
  card.dataset.focusKey = "root";

  const head = document.createElement("div");
  head.className = "seed-card-head";

  const identity = document.createElement("div");
  identity.className = "seed-card-identity";

  if (rootProfile.avatar_url) {
    const avatar = document.createElement("img");
    avatar.className = "seed-avatar";
    avatar.src = rootProfile.avatar_url;
    avatar.alt = rootProfile.full_name;
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
    <h3>${escapeHtml(rootProfile.full_name)}</h3>
    <p>${escapeHtml(rootProfile.input_profile)}</p>
  `;
  identity.appendChild(copy);

  const flag = document.createElement("span");
  flag.className = "flag seed";
  flag.textContent = "Корень";

  head.append(identity, flag);

  const details = document.createElement("p");
  details.textContent = rootProfile.is_private
    ? "Профиль закрыт. Глубокий обход друзей недоступен."
    : (
      `Запрошенная глубина: ${rootProfile.requested_depth}. `
      + `Доступных друзей первого слоя: ${rootProfile.direct_connection_count}`
      + (
        rootProfile.total_available_connection_count > 0
          ? ` из ${rootProfile.total_available_connection_count}.`
          : "."
      )
    );

  const flags = document.createElement("div");
  flags.className = "seed-flags";
  flags.appendChild(buildFlag("seed", `Глубина ${rootProfile.requested_depth}`));
  if (rootProfile.is_private) {
    flags.appendChild(buildFlag("error", "Профиль закрыт"));
  }
  if (rootProfile.is_truncated) {
    flags.appendChild(buildFlag("warn", "Часть связей отсечена лимитом"));
  }
  if (stats.exploration_was_limited) {
    flags.appendChild(buildFlag("warn", "Исследование ограничено бюджетом"));
  }

  const actions = document.createElement("div");
  actions.className = "seed-card-actions";

  const focusButton = document.createElement("button");
  focusButton.type = "button";
  focusButton.className = "button ghost subtle";
  focusButton.dataset.toggleFocus = "true";
  focusButton.dataset.inactiveLabel = "Показать корень";
  focusButton.dataset.activeLabel = "Снять выделение";
  focusButton.textContent = focusButton.dataset.inactiveLabel;
  focusButton.addEventListener("click", () => onToggleRootFocus());

  const openLink = document.createElement("a");
  openLink.className = "button ghost subtle";
  openLink.href = rootProfile.profile_url;
  openLink.target = "_blank";
  openLink.rel = "noopener noreferrer";
  openLink.textContent = "Открыть VK";

  actions.append(focusButton, openLink);
  card.append(head, details, flags, actions);
  container.appendChild(card);

  updateActiveCards(document, activeFocusKey);
}

export function renderCycles({
  container,
  cycles,
  nodes,
  activeFocusKey,
  onToggleCycleFocus,
}) {
  container.innerHTML = "";

  if (!cycles.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "Циклы в доступной глубине не найдены.";
    container.appendChild(empty);
    return;
  }

  const nodeMap = new Map(nodes.map((node) => [node.node_id, node]));

  cycles.forEach((cycle, index) => {
    const card = document.createElement("article");
    card.className = "overlap-card cycle-card";
    card.dataset.focusKey = `cycle:${cycle.cycle_id}`;

    const previewNames = cycle.node_ids
      .map((nodeId) => nodeMap.get(nodeId)?.full_name || nodeId)
      .slice(0, 5);
    const previewMarkup = previewNames.length
      ? `
        <div class="overlap-preview">
          ${previewNames.map((name) => `<span class="preview-chip">${escapeHtml(name)}</span>`).join("")}
          ${cycle.node_ids.length > previewNames.length ? `<span class="preview-chip">+${cycle.node_ids.length - previewNames.length} ещё</span>` : ""}
        </div>
      `
      : "";

    card.innerHTML = `
      <div class="overlap-card-head">
        <h3>Цикл #${index + 1}</h3>
        <span class="flag shared">${cycle.length}</span>
      </div>
      <p>
        Длина цикла: ${cycle.length}. Ближайшая точка входа на глубине ${cycle.closest_distance_from_root}.
        ${cycle.includes_root ? "Корневой профиль входит в этот цикл." : "Во фокус попадёт и путь от корня до цикла."}
      </p>
      ${previewMarkup}
    `;

    const actions = document.createElement("div");
    actions.className = "overlap-card-actions";

    const meta = document.createElement("div");
    meta.className = "overlap-meta";
    meta.appendChild(buildFlag("shared", cycle.includes_root ? "Цикл с корнем" : "Удалённый цикл"));
    meta.appendChild(buildFlag("seed", `Глубина ${cycle.closest_distance_from_root}`));

    const actionButton = document.createElement("button");
    actionButton.type = "button";
    actionButton.className = "button ghost subtle";
    actionButton.dataset.toggleFocus = "true";
    actionButton.dataset.inactiveLabel = "Подсветить цикл";
    actionButton.dataset.activeLabel = "Снять подсветку";
    actionButton.textContent = actionButton.dataset.inactiveLabel;
    actionButton.addEventListener("click", () => onToggleCycleFocus(cycle));

    actions.append(meta, actionButton);
    card.append(actions);
    container.appendChild(card);
  });

  updateActiveCards(document, activeFocusKey);
}

function buildFlag(kind, text) {
  const flag = document.createElement("span");
  flag.className = `flag ${kind === "warn" ? "warn" : kind === "error" ? "error" : kind === "shared" ? "shared" : "seed"}`;
  flag.textContent = text;
  return flag;
}
