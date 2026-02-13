#!/usr/bin/env node
/* eslint-disable no-console */
//node scripts/add-centers.js
//npx ng build map-element -c production --base-href=/genplan/ --deploy-url=/genplan/

const fs = require('fs/promises');
const path = require('path');

// --- CLI ---
const DEFAULT_DIR = path.resolve(process.cwd(), 'projects/app/src/assets/data/boundaries');
const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.findIndex(a => a === name || a.startsWith(name + '='));
  if (i === -1) return def;
  const v = argv[i].includes('=') ? argv[i].split('=').slice(1).join('=') : argv[i + 1];
  return v === undefined ? true : v;
};

const DIR       = path.resolve(arg('--dir', DEFAULT_DIR));
const DRY       = !!arg('--dry', false);
const NO_BACKUP = !!arg('--no-backup', false);
const PREC      = Number(arg('--prec', 6)); // точность записи центра

// --- Проекция (меркатор Web 3857) ---
const R = 6378137; // радиус сферической Земли (WGS84)
function lonLatToMerc([lon, lat]) {
  const x = (lon * Math.PI / 180) * R;
  const y = Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2)) * R;
  return [x, y];
}
function mercToLonLat([x, y]) {
  const lon = (x / R) * 180 / Math.PI;
  const lat = (2 * Math.atan(Math.exp(y / R)) - Math.PI / 2) * 180 / Math.PI;
  return [lon, lat];
}

// центроид одного кольца (в ПЛОСКИХ координатах!)
function ringCentroidXY(ring) {
  let area = 0, cx = 0, cy = 0;
  const n = ring.length;
  if (n < 3) return ring[0] || [0, 0];

  for (let i = 0; i < n; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[(i + 1) % n];
    const f = x1 * y2 - x2 * y1;
    area += f;
    cx += (x1 + x2) * f;
    cy += (y1 + y2) * f;
  }
  area *= 0.5;
  if (!area) return ring[0];
  return [cx / (6 * area), cy / (6 * area)];
}

// центроид полигона (берём ВНЕШНЕЕ кольцо: coordinates[0])
function polygonCentroidLonLat(coords, crsName) {
  const ring = coords?.[0];
  if (!Array.isArray(ring) || ring.length < 3) return null;

  // если координаты в метрах (EPSG:3857), считаем центроид прямо в XY
  if (crsName === 'EPSG:3857') {
    const xy = ring.map(([x, y]) => [x, y]);
    const cxy = ringCentroidXY(xy);
    return mercToLonLat(cxy);
  }

  // иначе считаем, что это lon/lat → переводим в меркатор, считаем центроид, возвращаем lon/lat
  const xy = ring.map(([lon, lat]) => lonLatToMerc([lon, lat]));
  const cxy = ringCentroidXY(xy);
  return mercToLonLat(cxy);
}

// для MultiPolygon берём площадь-взвешенный центроид по внешним контурам
function multiPolygonCentroidLonLat(coords, crsName) {
  if (!Array.isArray(coords) || !coords.length) return null;

  let sumArea = 0, sumX = 0, sumY = 0;

  for (const poly of coords) {
    const ring = poly?.[0];
    if (!Array.isArray(ring) || ring.length < 3) continue;

    let xy;
    if (crsName === 'EPSG:3857') xy = ring.map(([x, y]) => [x, y]);
    else xy = ring.map(([lon, lat]) => lonLatToMerc([lon, lat]));

    // площадь кольца
    let area = 0;
    for (let i = 0; i < xy.length; i++) {
      const [x1, y1] = xy[i];
      const [x2, y2] = xy[(i + 1) % xy.length];
      area += x1 * y2 - x2 * y1;
    }
    area *= 0.5;
    if (!area) continue;

    const [cx, cy] = ringCentroidXY(xy);
    sumArea += Math.abs(area);
    sumX += cx * Math.abs(area);
    sumY += cy * Math.abs(area);
  }

  if (!sumArea) return null;
  return mercToLonLat([sumX / sumArea, sumY / sumArea]);
}

async function listJsonFiles(dir) {
  const items = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const it of items) {
    if (it.isDirectory()) {
      files.push(...await listJsonFiles(path.join(dir, it.name)));
    } else if (it.isFile() && it.name.toLowerCase().endsWith('.json') && it.name !== 'index.json') {
      files.push(path.join(dir, it.name));
    }
  }
  return files;
}

async function processFile(file) {
  try {
    const raw = await fs.readFile(file, 'utf8');
    const json = JSON.parse(raw);

    if (json?.type !== 'FeatureCollection' || !Array.isArray(json.features)) {
      console.warn('Skip (not FeatureCollection):', path.relative(DIR, file));
      return { updated: false };
    }

    const before = JSON.stringify(json);
    for (const feat of json.features) {
      const geom = feat?.geometry;
      if (!geom || !geom.type || !geom.coordinates) continue;

      const crsName = geom?.crs?.properties?.name || geom?.crs?.properties?.Name || null;
      let center = null;

      if (geom.type === 'Polygon') {
        center = polygonCentroidLonLat(geom.coordinates, crsName);
      } else if (geom.type === 'MultiPolygon') {
        center = multiPolygonCentroidLonLat(geom.coordinates, crsName);
      }

      if (center) {
        const [lon, lat] = center;
        const fixed = [
          Number(lon.toFixed(PREC)),
          Number(lat.toFixed(PREC)),
        ];
        feat.properties = feat.properties || {};
        feat.properties.center = fixed; // <— пишем сюда
      }
    }

    const after = JSON.stringify(json);
    if (before === after) return { updated: false };

    if (DRY) {
      console.log('DRY update:', path.relative(DIR, file));
      return { updated: true, dry: true };
    }

    if (!NO_BACKUP) {
      await fs.writeFile(file + '.bak', raw);
    }
    await fs.writeFile(file, JSON.stringify(json, null, 2));
    console.log('Updated:', path.relative(DIR, file));
    return { updated: true };
  } catch (e) {
    console.error('Error:', file, e.message);
    return { updated: false, error: true };
  }
}

(async function main() {
  console.log('Directory:', DIR);
  const files = await listJsonFiles(DIR);
  if (!files.length) {
    console.log('No JSON files found.');
    return;
  }

  let updated = 0;
  for (const f of files) {
    const res = await processFile(f);
    if (res.updated) updated++;
  }
  console.log(`Done. Files: ${files.length}. Updated: ${updated}. ${DRY ? '(dry-run)' : ''}`);
})();
