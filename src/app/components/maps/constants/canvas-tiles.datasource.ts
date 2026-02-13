import type { FetchedRasterTile, RasterTileDataSourceDescription } from '@yandex/ymaps3-types';

export const layerId = 'canvas-layer-id';

const GRID_TILE = 256;
const TILE_PX = 1024;
const DEBUG = false;


const PADDING = { left: 0.020, right: 0, top: 0, bottom: 0.090 };

// ВАЖНО: явный тип number, чтобы не получать TS2367
const ROTATE_DEG: number = 0; // подберите угол (например, 1.5 или -1.2)

const OVERLAY_POLY: [number, number][] = [
  [36.54208649, 55.19205309],
  [36.54245606, 55.19171904],
  [36.54246162, 55.19171567],
  [36.54308944, 55.19193614],
  [36.54285438, 55.19218485],
  [36.54280291, 55.19221],
  [36.54273537, 55.19220906],
  [36.54208649, 55.19205309],
];

const imagePromise = new Promise<HTMLImageElement>((resolve, reject) => {
  const img = new Image();
  img.src = 'assets/images/location.svg';
  img.onload = () => resolve(img);
  img.onerror = reject;
});

const E = 0.08181919084262149;

function projectLngLatToWorldPx(lon: number, lat: number, z: number, tile = GRID_TILE) {
  const W = tile * (1 << z);
  const x = ((lon + 180) / 360) * W;
  const phi = (lat * Math.PI) / 180;
  const s = Math.sin(phi);
  const T = Math.tan(Math.PI / 4 + phi / 2) * Math.pow((1 - E * s) / (1 + E * s), E / 2);
  const y = (0.5 - Math.log(T) / (2 * Math.PI)) * W;
  return { x, y };
}

function getOverlayRectPx(z: number) {
  let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
  for (const [lon, lat] of OVERLAY_POLY) {
    const p = projectLngLatToWorldPx(lon, lat, z);
    if (p.x < minX) minX = p.x;
    if (p.y < minY) minY = p.y;
    if (p.x > maxX) maxX = p.x;
    if (p.y > maxY) maxY = p.y;
  }
  return { minX, minY, maxX, maxY, w: maxX - minX, h: maxY - minY };
}

function intersect(a: { l: number; t: number; r: number; b: number },
  b: { l: number; t: number; r: number; b: number }) {
  const l = Math.max(a.l, b.l);
  const t = Math.max(a.t, b.t);
  const r = Math.min(a.r, b.r);
  const btm = Math.min(a.b, b.b);
  return (r <= l || btm <= t) ? null : { l, t, r, b: btm, w: r - l, h: btm - t };
}

// AABB для повернутого drawBox
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

export const rasterDataSource: RasterTileDataSourceDescription = {
  type: layerId,
  size: GRID_TILE,
  transparent: true,

  async fetchTile(x: number, y: number, z: number): Promise<FetchedRasterTile> {
    const canvas = document.createElement('canvas');
    canvas.width = TILE_PX;
    canvas.height = TILE_PX;
    const ctx = canvas.getContext('2d')!;
    const scale = TILE_PX / GRID_TILE;
    ctx.setTransform(scale, 0, 0, scale, 0, 0);

    if (DEBUG) {
      ctx.strokeStyle = '#7B7D85';
      ctx.strokeRect(0, 0, GRID_TILE, GRID_TILE);
      ctx.font = '12px Arial, sans-serif';
      ctx.fillStyle = '#999';
      ctx.fillText(`x:${x} y:${y} z:${z}`, 8, 16);
    }

    const box = getOverlayRectPx(z);

    const padL = box.w * PADDING.left;
    const padR = box.w * PADDING.right;
    const padT = box.h * PADDING.top;
    const padB = box.h * PADDING.bottom;

    const drawBox = {
      minX: box.minX + padL,
      minY: box.minY + padT,
      maxX: box.maxX - padR,
      maxY: box.maxY - padB,
      w: box.w - padL - padR,
      h: box.h - padT - padB,
    };

    const tileRect = {
      l: x * GRID_TILE,
      t: y * GRID_TILE,
      r: (x + 1) * GRID_TILE,
      b: (y + 1) * GRID_TILE,
    };

    const angle = (ROTATE_DEG * Math.PI) / 180;
    const hasRotation = Math.abs(angle) > 1e-9;

    const testRect = hasRotation
      ? rotatedAABB(drawBox, angle)
      : { l: drawBox.minX, t: drawBox.minY, r: drawBox.maxX, b: drawBox.maxY };

    const cross = intersect(tileRect, testRect);
    if (!cross) return { image: canvas };

    const img = await imagePromise;
    const imgW = img.naturalWidth || img.width;
    const imgH = img.naturalHeight || img.height;

    if (!hasRotation) {
      // без поворота — режем по тайлам как раньше
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
      // с поворотом — рисуем трансформом (мир→тайл, центр, rotate, scale)
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

    // const g = ctx.createLinearGradient(0, 0, 0, GRID_TILE);
    // g.addColorStop(0, 'rgba(245,81,89,0.11)');
    // g.addColorStop(0.6771, 'rgba(245,81,89,0.00)');
    // ctx.fillStyle = g;
    // ctx.fillRect(0, 0, GRID_TILE, GRID_TILE);

    if (DEBUG) {
      ctx.strokeStyle = 'rgba(0,200,0,.85)';
      ctx.lineWidth = 1;
      ctx.strokeRect(drawBox.minX - tileRect.l, drawBox.minY - tileRect.t, drawBox.w, drawBox.h);
      ctx.fillText(`rotate: ${ROTATE_DEG}°`, 8, 32);
    }

    return { image: canvas };
  },
};
