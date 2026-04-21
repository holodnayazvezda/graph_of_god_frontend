import {
  average,
  buildSpatialGrid,
  clamp,
  hashString,
  resolveCollision,
} from "./utils.js";

export class GraphLayoutEngine {
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
