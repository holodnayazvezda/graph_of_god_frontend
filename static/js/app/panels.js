import { sourceLabel } from "./intersections.js";
import { escapeHtml } from "./utils.js";

export function renderSeedProfiles({
  container,
  seedProfiles,
  activeFocusKey,
  onToggleSeedFocus,
}) {
  container.innerHTML = "";

  seedProfiles.forEach((profile) => {
    const focusKey = `seed:${profile.seed_index}`;
    const card = document.createElement("article");
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
    actionButton.addEventListener("click", () => onToggleSeedFocus(profile.seed_index));

    const actionMeta = document.createElement("span");
    actionMeta.className = "muted";
    actionMeta.textContent = `На графе: ${profile.connection_count} связей профиля #${profile.seed_index + 1}.`;

    actions.append(actionButton, actionMeta);
    card.append(head, details, flags, actions);
    container.appendChild(card);
  });

  updateActiveCards(document, activeFocusKey);
}

export function renderOverlaps({
  container,
  groups,
  activeFocusKey,
  onToggleIntersectionFocus,
}) {
  container.innerHTML = "";

  if (!groups.length) {
    const empty = document.createElement("p");
    empty.className = "muted";
    empty.textContent = "Для одного профиля пересечений нет, а для нескольких пока не найдено общих друзей.";
    container.appendChild(empty);
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
    actionButton.addEventListener("click", () => onToggleIntersectionFocus(group));

    actions.append(meta, actionButton);
    card.append(actions);
    container.appendChild(card);
  });

  updateActiveCards(document, activeFocusKey);
}

export function updateActiveCards(root, activeFocusKey) {
  root.querySelectorAll("[data-focus-key]").forEach((element) => {
    const isActive = element.dataset.focusKey === activeFocusKey;
    element.classList.toggle("is-active", isActive);

    const button = element.querySelector("[data-toggle-focus]");
    if (button) {
      button.textContent = isActive ? button.dataset.activeLabel : button.dataset.inactiveLabel;
    }
  });
}

function buildFlag(kind, text) {
  const flag = document.createElement("span");
  flag.className = `flag ${kind === "warn" ? "warn" : kind === "private" ? "error" : kind === "shared" ? "shared" : "seed"}`;
  flag.textContent = text;
  return flag;
}
