export const DEFAULT_AVATAR_BUCKETS = [12, 16, 20, 24, 32, 40, 52];

export function getLayoutBounds(nodeLayout) {
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

export function createScreenBounds(width, height, padding) {
  return {
    minX: -padding,
    minY: -padding,
    maxX: width + padding,
    maxY: height + padding,
  };
}

export function isCircleVisible(item, bounds) {
  return (
    item.x + item.radius >= bounds.minX
    && item.x - item.radius <= bounds.maxX
    && item.y + item.radius >= bounds.minY
    && item.y - item.radius <= bounds.maxY
  );
}

export function createAvatarSprite(image, size) {
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

export function createCanvasSurface(width, height) {
  if (typeof OffscreenCanvas !== "undefined") {
    return new OffscreenCanvas(width, height);
  }

  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  return canvas;
}

export function isSegmentVisible(source, target, bounds) {
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

export function buildSpatialGrid(items, cellSize) {
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

export function resolveCollision(left, right, padding) {
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

export function average(values) {
  if (!values.length) return 0;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

export function lerp(start, end, progress) {
  return start + (end - start) * progress;
}

export function smoothstep(start, end, value) {
  if (end <= start) {
    return value >= end ? 1 : 0;
  }

  const progress = clamp((value - start) / (end - start), 0, 1);
  return progress * progress * (3 - (2 * progress));
}

export function easeOutCubic(progress) {
  return 1 - Math.pow(1 - progress, 3);
}

export function hashString(value) {
  let hash = 0;
  for (let idx = 0; idx < value.length; idx += 1) {
    hash = ((hash << 5) - hash) + value.charCodeAt(idx);
    hash |= 0;
  }
  return Math.abs(hash);
}

export function trimLabel(value, maxLength) {
  if (value.length <= maxLength) {
    return value;
  }
  return `${value.slice(0, maxLength - 1)}…`;
}

export function buildInitials(value) {
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

export function escapeTooltip(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;");
}
