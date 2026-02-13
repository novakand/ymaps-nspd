#!/usr/bin/env node
/* eslint-disable no-console */
const fs = require('fs/promises');
const path = require('path');
//node scripts/convert-parcels.js
// папка: ymaps-interactive/projects/app/src/assets/data/parcels
//other
const DEFAULT_DIR = path.resolve(__dirname, '../projects/app/src/assets/data/parcels');

// ------------------------- CLI -------------------------
const argv = process.argv.slice(2);
const arg = (name, def = undefined) => {
  const i = argv.findIndex(a => a === name || a.startsWith(name + '='));
  if (i === -1) return def;
  const v = argv[i].includes('=') ? argv[i].split('=').slice(1).join('=') : argv[i + 1];
  return v === undefined ? true : v;
};
const DIR = arg('--dir', DEFAULT_DIR);
const DRY = !!arg('--dry', false);
const NO_BACKUP = !!arg('--no-backup', false);
const PREC = Number(arg('--prec', 8)); // точность округления

// --------------------- Проекция 3857→4326 ---------------------
const R = 20037508.34;
function mercToLonLat(x, y) {
  const lon = (x / R) * 180;
  let lat = (y / R) * 180;
  lat = (180 / Math.PI) * (2 * Math.atan(Math.exp((lat * Math.PI) / 180)) - Math.PI / 2);
  return [lon, lat];
}
const round = (n, p = 8) => Number.isFinite(n) ? Number(n.toFixed(p)) : n;

// ----------------------- Вспомогательное -----------------------
function looksLike3857Pair([x, y]) {
  // Метры ~|x|,|y| до ~20 млн; градусы всегда в [-180..180],[-90..90]
  return Math.abs(x) > 1000 || Math.abs(y) > 1000;
}
function geomHas3857(geom) {
  if (!geom) return false;
  if (geom.type === 'GeometryCollection') {
    return (geom.geometries || []).some(geomHas3857);
  }
  const c = geom.coordinates;
  if (!c) return false;
  // Достаем первый узел с парой чисел
  function firstPair(v) {
    if (Array.isArray(v) && typeof v[0] === 'number' && typeof v[1] === 'number') return v;
    if (Array.isArray(v)) for (const u of v) { const p = firstPair(u); if (p) return p; }
    return null;
  }
  const p = firstPair(c);
  return p ? looksLike3857Pair(p) : false;
}

function convertGeomInPlace(geom, prec = 8) {
  if (!geom) return geom;
  if (geom.type === 'GeometryCollection') {
    (geom.geometries || []).forEach(g => convertGeomInPlace(g, prec));
    return geom;
  }
  const c = geom.coordinates;
  if (!c) return geom;

  function mapCoords(v) {
    if (Array.isArray(v) && typeof v[0] === 'number' && typeof v[1] === 'number') {
      const [lon, lat] = mercToLonLat(v[0], v[1]);
      return [round(lon, prec), round(lat, prec)];
    }
    if (Array.isArray(v)) return v.map(mapCoords);
    return v;
  }

  // Конвертируем ТОЛЬКО если это действительно 3857
  if (geomHas3857(geom)) {
    geom.coordinates = mapCoords(c);
    // Обновим/проставим CRS, если поле есть
    if (geom.crs && geom.crs.properties) {
      geom.crs.properties.name = 'EPSG:4326';
    }
  }
  return geom;
}

function convertFCInPlace(fc, prec = 8) {
  if (!fc || fc.type !== 'FeatureCollection') return false;
  let changed = false;
  for (const f of fc.features || []) {
    if (f && f.geometry && geomHas3857(f.geometry)) {
      convertGeomInPlace(f.geometry, prec);
      changed = true;
    }
  }
  return changed;
}

// ----------------------- Обход файлов -----------------------
async function listJsonFiles(dir) {
  const items = await fs.readdir(dir, { withFileTypes: true });
  const files = [];
  for (const i of items) {
    const full = path.join(dir, i.name);
    if (i.isDirectory()) {
      const sub = await listJsonFiles(full);
      files.push(...sub);
    } else if (/\.(geo)?json$/i.test(i.name)) {
      files.push(full);
    }
  }
  return files;
}

async function processFile(file) {
  try {
    const raw = await fs.readFile(file, 'utf8');
    const data = JSON.parse(raw);

    if (data.type !== 'FeatureCollection') {
      console.log(' skip (not FeatureCollection):', path.relative(DIR, file));
      return;
    }

    const need = (data.features || []).some(f => f && f.geometry && geomHas3857(f.geometry));
    if (!need) {
      console.log(' ok   (already 4326):        ', path.relative(DIR, file));
      return;
    }

    if (!DRY && !NO_BACKUP) {
      await fs.writeFile(file + '.bak3857', raw);
    }

    const changed = convertFCInPlace(data, PREC);
    if (!changed) {
      console.log(' ?    (nothing changed):     ', path.relative(DIR, file));
      return;
    }

    const out = JSON.stringify(data, null, 2);
    if (!DRY) await fs.writeFile(file, out, 'utf8');

    console.log((DRY ? 'would' : 'done'), '-> 4326:              ', path.relative(DIR, file));
  } catch (e) {
    console.error('ERR  ', path.relative(DIR, file), e.message);
  }
}

(async () => {
  console.log('Dir :', DIR);
  console.log('Dry :', DRY, ' | No backup :', NO_BACKUP, ' | precision :', PREC);
  const files = await listJsonFiles(DIR);
  if (!files.length) {
    console.log('Нет файлов .json/.geojson');
    return;
  }
  for (const f of files) await processFile(f);
  console.log('Готово.');
})();
