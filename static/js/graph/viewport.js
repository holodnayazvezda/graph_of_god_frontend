import { clamp } from "./utils.js";

export class GraphViewport {
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
