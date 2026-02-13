// canvas-overlay-source.ts
import type {
  FetchedRasterTile,
  RasterTileDataSourceDescription,
} from '@yandex/ymaps3-types';

export type LngLat = [number, number];
const CANVAS_OVERLAY_TYPE = 'canvas-overlay';

export type PaddingPercent = {
  left?: number;  // доля ширины bbox, 0..1
  right?: number;
  top?: number;   // доля высоты bbox, 0..1
  bottom?: number;
};

export type ProjectionKind = 'sphere' | 'ellipsoid';

export interface CanvasOverlayOptions {
  id?: string;                               // id источника/типа слоя
  overlayPoly: LngLat[];                     // [lon, lat]
  image: string | HTMLImageElement | Promise<HTMLImageElement>;
  rotateDeg?: number;                        // угол поворота картинки
  padding?: number | PaddingPercent;         // число = одинаково со всех сторон
  tileSize?: number;                         // GRID_TILE (по умолчанию 256)
  tilePx?: number;                           // TILE_PX (по умолчанию 1024)
  zIndex?: number;                           // zIndex слоя (по умолчанию 2010)
  debug?: boolean;
  projection?: ProjectionKind;               // 'sphere' (3857) или 'ellipsoid' (3395-подобная)
}

const DEFAULTS = {
  id: 'canvas-layer-id',
  tileSize: 256,
  tilePx: 1024,
  rotateDeg: 0,
  zIndex: 2010,
  debug: false,
  projection: 'ellipsoid' as ProjectionKind, // можно сменить на 'sphere' при желании
};

const E = 0.08181919084262149; // эксцентриситет (для эллипсоидальной формулы)

function normPadding(p?: number | PaddingPercent): Required<PaddingPercent> {
  if (typeof p === 'number') return { left: p, right: p, top: p, bottom: p };
  return {
    left: p?.left ?? 0,
    right: p?.right ?? 0,
    top: p?.top ?? 0,
    bottom: p?.bottom ?? 0,
  };
}

function loadImage(srcOrImgOrPromise: CanvasOverlayOptions['image']): Promise<HTMLImageElement> {
  if (typeof srcOrImgOrPromise === 'string') {
    return new Promise((resolve, reject) => {
      const img = new Image();
      img.src = srcOrImgOrPromise;
      img.onload = () => resolve(img);
      img.onerror = (e) => reject(new Error(`Image load failed: ${img.src}`));
    });
  }
  if (srcOrImgOrPromise instanceof HTMLImageElement) {
    return Promise.resolve(srcOrImgOrPromise);
  }
  return srcOrImgOrPromise;
}

function projectLngLatToWorldPx(
  lon: number,
  lat: number,
  z: number,
  tile = 256,
  projection: ProjectionKind = 'sphere',
) {
  const W = tile * (1 << z); 
  const x = ((lon + 180) / 360) * W;

  const phi = (lat * Math.PI) / 180;
  const sin = Math.sin(phi);

  if (projection === 'sphere') {
    const y = (0.5 - Math.log((1 + sin) / (1 - sin)) / (4 * Math.PI)) * W;
    return { x, y };
  }

  const T = Math.tan(Math.PI / 4 + phi / 2) * Math.pow((1 - E * sin) / (1 + E * sin), E / 2);
  const y = (0.5 - Math.log(T) / (2 * Math.PI)) * W;
  return { x, y };
}

function rotatedAABB(drawBox: { minX: number; minY: number; maxX: number; maxY: number }, angleRad: number) {
  const cx = (drawBox.minX + drawBox.maxX) / 2;
  const cy = (drawBox.minY + drawBox.maxY) / 2;
  const corners = [
    { x: drawBox.minX, y: drawBox.minY },
    { x: drawBox.maxX, y: drawBox.minY },
    { x: drawBox.maxX, y: drawBox.maxY },
    { x: drawBox.minX, y: drawBox.maxY },
  ];
  const cos = Math.cos(angleRad), sin = Math.sin(angleRad);
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const p of corners) {
    const dx = p.x - cx, dy = p.y - cy;
    const rx = cx + dx * cos - dy * sin;
    const ry = cy + dx * sin + dy * cos;
    if (rx < minX) minX = rx;
    if (ry < minY) minY = ry;
    if (rx > maxX) maxX = rx;
    if (ry > maxY) maxY = ry;
  }
  return { l: minX, t: minY, r: maxX, b: maxY };
}

function intersect(
  a: { l: number; t: number; r: number; b: number },
  b: { l: number; t: number; r: number; b: number },
) {
  const l = Math.max(a.l, b.l);
  const t = Math.max(a.t, b.t);
  const r = Math.min(a.r, b.r);
  const btm = Math.min(a.b, b.b);
  return r <= l || btm <= t ? null : { l, t, r, b: btm, w: r - l, h: btm - t };
}

export class CanvasOverlaySource {
  readonly id: string;
  readonly raster: RasterTileDataSourceDescription;
  readonly layerProps: { source: string; transparent: boolean; type: string; zIndex: number };
  readonly tileSourceProps: { id: string; raster: RasterTileDataSourceDescription; tileSize: number };

  private opts: Required<CanvasOverlayOptions>;
  private imgPromise: Promise<HTMLImageElement>;
  private bboxCache = new Map<number, { minX: number; minY: number; maxX: number; maxY: number; w: number; h: number }>();

  constructor(options: CanvasOverlayOptions) {
    this.opts = {
      ...DEFAULTS,
      ...options,
      padding: normPadding(options.padding),
    } as Required<CanvasOverlayOptions>;
    this.id = this.opts.id;

    this.imgPromise = loadImage(this.opts.image);

    this.raster = {
      type: CANVAS_OVERLAY_TYPE,
      size: this.opts.tileSize,
      transparent: true,
      fetchTile: (x, y, z) => this.fetchTile(x, y, z),
    };

    this.layerProps = {
      source: this.id,
      transparent: true,
      type: CANVAS_OVERLAY_TYPE, 
      zIndex: this.opts.zIndex,
    };

    this.tileSourceProps = {
      id: this.id,
      raster: this.raster,
      tileSize: this.opts.tileSize,
    };
  }

  update(partial: Partial<CanvasOverlayOptions>) {
    if (partial.image) {
      this.imgPromise = loadImage(partial.image);
    }
    if (partial.overlayPoly) {
      this.opts.overlayPoly = partial.overlayPoly;
      this.bboxCache.clear();
    }
    if (partial.padding !== undefined) {
      this.opts.padding = normPadding(partial.padding) as any;
      this.bboxCache.clear();
    }
    if (partial.rotateDeg !== undefined) this.opts.rotateDeg = partial.rotateDeg;
    if (partial.projection) this.opts.projection = partial.projection;
    if (partial.debug !== undefined) this.opts.debug = partial.debug;
    if (partial.tileSize) (this.raster as any).size = partial.tileSize;
    if (partial.tilePx) this.opts.tilePx = partial.tilePx;
  }

  private getOverlayRectPx(z: number) {
    const cached = this.bboxCache.get(z);
    if (cached) return cached;

    let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
    for (const [lon, lat] of this.opts.overlayPoly) {
      const p = projectLngLatToWorldPx(lon, lat, z, this.opts.tileSize, this.opts.projection);
      if (p.x < minX) minX = p.x;
      if (p.y < minY) minY = p.y;
      if (p.x > maxX) maxX = p.x;
      if (p.y > maxY) maxY = p.y;
    }
    const box = { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
    this.bboxCache.set(z, box);
    return box;
  }

  private async fetchTile(x: number, y: number, z: number): Promise<FetchedRasterTile> {
    const canvas = document.createElement('canvas');
    canvas.width = this.opts.tilePx;
    canvas.height = this.opts.tilePx;
    const ctx = canvas.getContext('2d')!;
    const scale = this.opts.tilePx / this.opts.tileSize;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);

    if (this.opts.debug) {
      ctx.strokeStyle = '#7B7D85';
      ctx.strokeRect(0, 0, this.opts.tileSize, this.opts.tileSize);
      ctx.font = '12px Arial, sans-serif';
      ctx.fillStyle = '#999';
      ctx.fillText(`x:${x} y:${y} z:${z}`, 8, 16);
    }

    const box = this.getOverlayRectPx(z);
    const pad = this.opts.padding as Required<PaddingPercent>;

    const padL = box.w * (pad.left ?? 0);
    const padR = box.w * (pad.right ?? 0);
    const padT = box.h * (pad.top ?? 0);
    const padB = box.h * (pad.bottom ?? 0);

    const drawBox = {
      minX: box.minX + padL,
      minY: box.minY + padT,
      maxX: box.maxX - padR,
      maxY: box.maxY - padB,
      w: box.w - padL - padR,
      h: box.h - padT - padB,
    };

    const tileRect = {
      l: x * this.opts.tileSize,
      t: y * this.opts.tileSize,
      r: (x + 1) * this.opts.tileSize,
      b: (y + 1) * this.opts.tileSize,
    };

    const angle = (this.opts.rotateDeg * Math.PI) / 180;
    const hasRotation = Math.abs(angle) > 1e-9;

    const testRect = hasRotation
      ? rotatedAABB(drawBox, angle)
      : { l: drawBox.minX, t: drawBox.minY, r: drawBox.maxX, b: drawBox.maxY };

    const cross = intersect(tileRect, testRect);
    if (!cross) return { image: canvas };

    const img = await this.imgPromise;
    const imgW = (img as HTMLImageElement).naturalWidth || img.width;
    const imgH = (img as HTMLImageElement).naturalHeight || img.height;

    if (!hasRotation) {
      const destX = cross.l - tileRect.l;
      const destY = cross.t - tileRect.t;
      const destW = cross.w;
      const destH = cross.h;

      const srcX = ((cross.l - drawBox.minX) / drawBox.w) * imgW;
      const srcY = ((cross.t - drawBox.minY) / drawBox.h) * imgH;
      const srcW = (cross.w / drawBox.w) * imgW;
      const srcH = (cross.h / drawBox.h) * imgH;

      ctx.drawImage(img, srcX, srcY, srcW, srcH, destX, destY, destW, destH);
    } else {
      const sx = drawBox.w / imgW;
      const sy = drawBox.h / imgH;
      const cx = (drawBox.minX + drawBox.maxX) / 2;
      const cy = (drawBox.minY + drawBox.maxY) / 2;

      ctx.save();
      ctx.translate(-tileRect.l, -tileRect.t);
      ctx.translate(cx, cy);
      ctx.rotate(angle);
      ctx.scale(sx, sy);
      ctx.drawImage(img, -imgW / 2, -imgH / 2);
      ctx.restore();
    }

    if (this.opts.debug) {
      ctx.strokeStyle = 'rgba(0,200,0,.85)';
      ctx.lineWidth = 1;
      ctx.strokeRect(drawBox.minX - tileRect.l, drawBox.minY - tileRect.t, drawBox.w, drawBox.h);
      ctx.fillText(`rotate: ${this.opts.rotateDeg}°`, 8, 32);
    }

    return { image: canvas };
  }
}
