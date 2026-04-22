import { GraphLayoutEngine } from "./layout.js";
import {
  buildInitials,
  clamp,
  createAvatarSprite,
  createScreenBounds,
  DEFAULT_AVATAR_BUCKETS,
  easeOutCubic,
  getLayoutBounds,
  isCircleVisible,
  isSegmentVisible,
  lerp,
  smoothstep,
  trimLabel,
} from "./utils.js";
import { GraphViewport } from "./viewport.js";

export class GraphRenderer {
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
    this.hoveredTooltipDescriptor = null;
    this.nodeLayout = [];
    this.nodeLayoutById = new Map();
    this.connectionIndex = new Map();
    this.imageCache = new Map();
    this.avatarSpriteCache = new Map();
    this.viewport = new GraphViewport();
    this.viewportListener = null;
    this.nodeActivateListener = null;
    this.nodeTooltipBuilder = null;
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
    this.canvas.addEventListener("pointerleave", (event) => this.onCanvasPointerLeave(event));
    this.canvas.addEventListener("wheel", (event) => this.onWheel(event), { passive: false });
    window.addEventListener("keydown", (event) => this.onKeyDown(event));
    this.tooltip.addEventListener("pointerleave", (event) => this.onTooltipPointerLeave(event));
  }

  setViewportListener(listener) {
    this.viewportListener = listener;
    this.notifyViewportChange();
  }

  setNodeActivateListener(listener) {
    this.nodeActivateListener = listener;
  }

  setNodeTooltipBuilder(listener) {
    this.nodeTooltipBuilder = listener;
  }

  hideTooltip() {
    this.hoveredNodeId = null;
    this.hoveredTooltipDescriptor = null;
    this.tooltip.hidden = true;
    this.tooltip.classList.remove("has-actions");
    this.tooltip.replaceChildren();
    this.canvas.classList.remove("is-hover-link");
  }

  onCanvasPointerLeave(event) {
    if (this.dragState?.isPanning) {
      return;
    }

    const nextTarget = event.relatedTarget;
    if (nextTarget && this.tooltip.contains(nextTarget)) {
      return;
    }

    this.hideTooltip();
  }

  onTooltipPointerLeave(event) {
    const nextTarget = event.relatedTarget;
    if (nextTarget && this.canvas.contains(nextTarget)) {
      return;
    }

    this.hideTooltip();
  }

  onKeyDown(event) {
    if (
      this.tooltip.hidden
      || !this.hoveredTooltipDescriptor?.actions?.length
      || event.repeat
      || event.ctrlKey
      || event.metaKey
      || event.altKey
      || this.isEditableTarget(event.target)
    ) {
      return;
    }

    const pressedKey = String(event.key || "").toLowerCase();
    if (!pressedKey) {
      return;
    }

    const matchedAction = this.hoveredTooltipDescriptor.actions.find((action) => action.shortcut === pressedKey);
    if (!matchedAction) {
      return;
    }

    event.preventDefault();
    event.stopPropagation();
    matchedAction.onSelect?.();
    this.hideTooltip();
  }

  isEditableTarget(target) {
    if (!(target instanceof Element)) {
      return false;
    }

    return Boolean(
      target.closest("input, textarea, select, button, [contenteditable='true'], [contenteditable='']")
    );
  }

  setData(result) {
    this.result = result;
    this.focus = null;
    this.renderProfile = this.resolveRenderProfile(result);
    this.currentPositions = new Map();
    this.hitItems = [];
    this.hoveredNodeId = null;
    this.hoveredTooltipDescriptor = null;
    this.avatarSpriteCache.clear();
    this.nodeLayout = this.buildLayout(result);
    this.reindexLayout();
    this.connectionIndex = this.buildConnectionIndex(result.edges);
    this.preloadAvatars(result.nodes);
    this.canvas.classList.add("is-interactive");
    this.canvas.classList.remove("is-panning", "is-hover-link");
    this.hideTooltip();
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
    this.hideTooltip();
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
    this.hoveredTooltipDescriptor = null;
    this.nodeLayout = [];
    this.nodeLayoutById = new Map();
    this.connectionIndex = new Map();
    this.avatarSpriteCache.clear();
    this.viewport.reset();
    this.layoutDirty = false;
    this.canvas.classList.remove("is-interactive", "is-panning", "is-hover-link");
    this.resizeCanvas();
    this.ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    this.hideTooltip();
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
    const palette = this.resolvePalette();
    this.drawBackdrop(width, height, palette);
    this.drawEdges(positions, edgeBounds, palette);
    this.drawNodes(positions, nodeBounds, palette);
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

  drawBackdrop(width, height, palette) {
    const gradient = this.ctx.createLinearGradient(0, 0, width, height);
    gradient.addColorStop(0, palette.backdropStart);
    gradient.addColorStop(1, palette.backdropEnd);
    this.ctx.fillStyle = gradient;
    this.ctx.fillRect(0, 0, width, height);
    if (this.renderProfile?.showGrid) {
      this.drawGrid(width, height, palette);
    }
  }

  drawGrid(width, height, palette) {
    const minWorld = this.viewport.screenToWorld(0, 0);
    const maxWorld = this.viewport.screenToWorld(width, height);
    const baseStep = 140;
    const scaleFactor = this.viewport.scale > 1.6 ? 0.5 : this.viewport.scale < 0.7 ? 2 : 1;
    const step = baseStep * scaleFactor;

    this.ctx.save();
    this.ctx.strokeStyle = palette.grid;
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

  drawEdges(positions, visibleBounds, palette) {
    const focusNodeIds = this.focus?.nodeIds || null;

    this.ctx.save();
    for (const edge of this.result.edges) {
      const source = positions.get(edge.source_node_id);
      const target = positions.get(edge.target_node_id);
      if (!source || !target) continue;
      if (!isSegmentVisible(source, target, visibleBounds)) continue;

      const isActive = !focusNodeIds || (focusNodeIds.has(edge.source_node_id) && focusNodeIds.has(edge.target_node_id));
      const isHighlightedEdge = edge.is_cycle_edge === true || edge.connected_seed_indices.length > 1;
      this.ctx.globalAlpha = isActive ? 1 : 0.08;
      this.ctx.lineWidth = clamp((isHighlightedEdge ? 1.8 : 1.15) * this.viewport.scale, 0.6, 2.8);
      this.ctx.strokeStyle = isHighlightedEdge
        ? palette.edgeShared
        : palette.edgeSingle;

      this.ctx.beginPath();
      this.ctx.moveTo(source.x, source.y);
      this.ctx.lineTo(target.x, target.y);
      this.ctx.stroke();
    }
    this.ctx.restore();
  }

  drawNodes(positions, visibleBounds, palette) {
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
      this.drawNode(item, isActive, palette);
    }

    for (const item of ordered) {
      if (!labeledIds.has(item.node.node_id)) continue;
      if (this.focus && !this.focus.nodeIds.has(item.node.node_id)) continue;
      this.drawLabel(item, palette);
    }
  }

  drawNode(item, isActive, palette) {
    const isCycleMember = item.node.is_cycle_member === true;
    const ringColor = item.node.is_seed
      ? palette.nodeSeed
      : isCycleMember || item.node.shared_seed_count >= 2
        ? palette.nodeShared
        : palette.nodeSingle;

    this.ctx.save();
    this.ctx.globalAlpha = isActive ? 1 : 0.14;
    if (this.renderProfile?.showShadows && isActive) {
      this.ctx.shadowBlur = clamp(item.radius * 0.65, 0, 18);
      this.ctx.shadowColor = isCycleMember || item.node.shared_seed_count >= 2
        ? palette.shadowShared
        : palette.shadowSingle;
    } else {
      this.ctx.shadowBlur = 0;
    }

    this.ctx.beginPath();
    this.ctx.arc(item.x, item.y, item.radius, 0, Math.PI * 2);
    this.ctx.fillStyle = palette.nodeFill;
    this.ctx.fill();

    const hasAvatar = this.drawAvatar(item);
    if (!hasAvatar) {
      this.ctx.beginPath();
      this.ctx.arc(item.x, item.y, Math.max(1, item.radius - 1.2), 0, Math.PI * 2);
      this.ctx.fillStyle = ringColor;
      this.ctx.fill();
      if (item.radius >= 9) {
        this.drawInitials(item, palette);
      }
    }

    this.ctx.beginPath();
    this.ctx.arc(item.x, item.y, item.radius, 0, Math.PI * 2);
    this.ctx.lineWidth = clamp((item.node.is_seed ? 3.4 : isCycleMember || item.node.shared_seed_count >= 2 ? 2.2 : 1.6) * this.viewport.scale, 1.1, 4);
    this.ctx.strokeStyle = ringColor;
    this.ctx.stroke();

    if (this.focus && isActive) {
      this.ctx.beginPath();
      this.ctx.arc(item.x, item.y, item.radius + clamp(4.5 * this.viewport.scale, 2.6, 6.2), 0, Math.PI * 2);
      this.ctx.lineWidth = clamp(1.3 * this.viewport.scale, 0.8, 2);
      this.ctx.strokeStyle = palette.focusRing;
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

  drawInitials(item, palette) {
    const initials = buildInitials(item.node.full_name || item.node.node_id);
    this.ctx.save();
    this.ctx.fillStyle = palette.initials;
    this.ctx.font = `${Math.max(8, Math.floor(item.radius * 0.9))}px "Avenir Next", sans-serif`;
    this.ctx.textAlign = "center";
    this.ctx.textBaseline = "middle";
    this.ctx.fillText(initials, item.x, item.y + 0.5);
    this.ctx.restore();
  }

  drawLabel(item, palette) {
    const label = trimLabel(item.node.full_name || item.node.node_id, item.node.is_seed ? 24 : 18);
    this.ctx.save();
    this.ctx.font = item.node.is_seed
      ? `${clamp(12 * this.viewport.scale, 10, 18)}px 'Avenir Next', sans-serif`
      : `${clamp(11 * this.viewport.scale, 9, 15)}px 'Avenir Next', sans-serif`;
    this.ctx.fillStyle = palette.label;
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
          : DEFAULT_AVATAR_BUCKETS,
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
      this.dragState = this.createNodeDragState(
        hitNode,
        pointerWorld,
        event.pointerId,
        event.clientX,
        event.clientY,
      );
      this.canvas.classList.add("is-panning");
      this.hideTooltip();
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
        const movedEnough = Math.hypot(
          event.clientX - this.dragState.startClientX,
          event.clientY - this.dragState.startClientY,
        ) >= 3;
        if (!movedEnough) {
          return;
        }

        this.dragState.hasMoved = true;
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
          this.hideTooltip();
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
        this.hideTooltip();
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

    if (finishedDragState.mode === "node" && finishedDragState.hasMoved) {
      this.commitDraggedNodeState(finishedDragState);
    } else if (finishedDragState.mode === "node") {
      this.activateNode(finishedDragState.nodeId);
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
    this.hideTooltip();
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
      this.hideTooltip();
      return;
    }

    const tooltipDescriptor = this.buildTooltipDescriptor(hovered.node);
    this.hoveredTooltipDescriptor = tooltipDescriptor;

    this.canvas.classList.toggle(
      "is-hover-link",
      Boolean(hovered.node.profile_url || tooltipDescriptor.actions?.length),
    );
    if (this.hoveredNodeId !== hovered.node.node_id) {
      this.renderTooltipContent(tooltipDescriptor);
      this.hoveredNodeId = hovered.node.node_id;
    }
    this.tooltip.style.left = `${pointerX}px`;
    this.tooltip.style.top = `${pointerY}px`;
    this.tooltip.hidden = false;
  }

  buildRelationshipLabel(node) {
    if (typeof node.is_cycle_member === "boolean") {
      if (node.is_seed) {
        return "Корневой профиль";
      }

      const depthLabel = Number.isFinite(node.distance_from_root)
        ? `, глубина ${node.distance_from_root}`
        : "";
      return node.is_cycle_member
        ? `Узел цикла${depthLabel}`
        : `Путь к циклу${depthLabel}`;
    }

    if (node.is_seed) {
      return `Исходный профиль #${(node.seed_indices[0] || 0) + 1}`;
    }

    if (node.connected_seed_indices.length > 1) {
      return `Общий друг профилей ${node.connected_seed_indices.map((index) => `#${index + 1}`).join(", ")}`;
    }

    return `Друг профиля #${(node.connected_seed_indices[0] || 0) + 1}`;
  }

  buildTooltipDescriptor(node) {
    const fallbackDescriptor = {
      title: node.full_name,
      subtitle: this.buildRelationshipLabel(node),
      actions: [],
    };

    if (!this.nodeTooltipBuilder) {
      return fallbackDescriptor;
    }

    return {
      ...fallbackDescriptor,
      ...(this.nodeTooltipBuilder(node, fallbackDescriptor) || {}),
    };
  }

  renderTooltipContent(descriptor) {
    this.tooltip.replaceChildren();
    this.tooltip.classList.toggle("has-actions", Boolean(descriptor.actions?.length));

    const title = document.createElement("strong");
    title.className = "graph-tooltip-title";
    title.textContent = descriptor.title;
    this.tooltip.appendChild(title);

    if (descriptor.subtitle) {
      const subtitle = document.createElement("span");
      subtitle.className = "graph-tooltip-subtitle";
      subtitle.textContent = descriptor.subtitle;
      this.tooltip.appendChild(subtitle);
    }

    if (!descriptor.actions?.length) {
      return;
    }

    const actions = document.createElement("div");
    actions.className = "graph-tooltip-actions";

    descriptor.actions.forEach((action) => {
      const row = document.createElement("div");
      row.className = "graph-tooltip-shortcut";

      const key = document.createElement("kbd");
      key.className = "graph-tooltip-key";
      key.textContent = String(action.shortcut || "").toUpperCase();

      const label = document.createElement("span");
      label.className = "graph-tooltip-shortcut-label";
      label.textContent = action.label;

      row.append(key, label);
      actions.appendChild(row);
    });

    this.tooltip.appendChild(actions);
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

  createNodeDragState(hitNode, pointerWorld, pointerId, startClientX, startClientY) {
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
      startClientX,
      startClientY,
      originX: hitNode.worldX,
      originY: hitNode.worldY,
      originPositions,
      influenceMap,
      dragProfile,
      hasMoved: false,
    };
  }

  activateNode(nodeId) {
    const node = this.nodeLayoutById.get(nodeId)?.node;
    if (!node || !this.nodeActivateListener) {
      return;
    }

    this.nodeActivateListener(node);
  }

  resolvePalette() {
    const styles = getComputedStyle(this.canvas);
    return {
      backdropStart: styles.getPropertyValue("--graph-backdrop-start").trim(),
      backdropEnd: styles.getPropertyValue("--graph-backdrop-end").trim(),
      grid: styles.getPropertyValue("--graph-grid").trim(),
      edgeShared: styles.getPropertyValue("--graph-edge-shared").trim(),
      edgeSingle: styles.getPropertyValue("--graph-edge-single").trim(),
      nodeFill: styles.getPropertyValue("--graph-node-fill").trim(),
      nodeSeed: styles.getPropertyValue("--graph-node-seed").trim(),
      nodeShared: styles.getPropertyValue("--graph-node-shared").trim(),
      nodeSingle: styles.getPropertyValue("--graph-node-single").trim(),
      shadowShared: styles.getPropertyValue("--graph-shadow-shared").trim(),
      shadowSingle: styles.getPropertyValue("--graph-shadow-single").trim(),
      focusRing: styles.getPropertyValue("--graph-focus-ring").trim(),
      initials: styles.getPropertyValue("--graph-initials").trim(),
      label: styles.getPropertyValue("--graph-label").trim(),
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
