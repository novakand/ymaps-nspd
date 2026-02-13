#!/usr/bin/env node
/* eslint-disable no-console */
const fs   = require('fs/promises');
const path = require('path');
const turf = require('@turf/turf');

const DEF_PARCELS_DIR = path.resolve(__dirname, '../projects/app/src/assets/data/parcels');
const DEF_OTHER_DIR   = path.resolve(__dirname, '../projects/app/src/assets/data/other');

const argv = process.argv.slice(2);
const arg = (k, def) => {
  const a = argv.find(s => s === k || s.startsWith(k + '='));
  if (!a) return def;
  return a.includes('=') ? a.split('=').slice(1).join('=') : true;
};

const PARCELS_DIR = String(arg('--parcels', DEF_PARCELS_DIR));
const OTHER_DIR   = String(arg('--other',   DEF_OTHER_DIR));
const OUT_NAME    = String(arg('--out', 'border.json'));
const EPSILON_M   = Number(arg('--epsilon', 1));     // «склейка» в метрах
const PREC        = Number(arg('--prec', 6));        // округление координат
const VERBOSE     = !!arg('--verbose', false);

const isJson   = f => f.toLowerCase().endsWith('.json');
const readJson = async p => JSON.parse(await fs.readFile(p, 'utf8'));
const exists   = async p => !!(await fs.stat(p).catch(() => false));

async function listGeojsonFiles(dir) {
  const set = new Set();
  const idx = path.join(dir, 'index.json');
  if (await exists(idx)) {
    try {
      const arr = await readJson(idx);
      if (Array.isArray(arr)) arr.forEach(f => { if (typeof f === 'string' && isJson(f)) set.add(f); });
    } catch {}
  }
  for (const f of await fs.readdir(dir)) {
    if (!isJson(f)) continue;
    if (f === 'index.json') continue;
    if (f.includes('.bak')) continue;
    if (/^border/i.test(f)) continue; // не подмешиваем уже собранную границу
    set.add(f);
  }
  return [...set];
}

function isPolygonFeatureValid(feat) {
  if (!feat || feat.type !== 'Feature' || !feat.geometry) return false;
  const g = feat.geometry;
  if (g.type !== 'Polygon') return false;
  const rings = g.coordinates;
  if (!Array.isArray(rings) || rings.length === 0) return false;
  const outer = rings[0];
  return Array.isArray(outer) && outer.length >= 4 && outer.every(pt => Array.isArray(pt) && pt.length === 2 && isFinite(pt[0]) && isFinite(pt[1]));
}

async function readPolygonsFromFile(absPath) {
  let data;
  try { data = await readJson(absPath); } catch (e) {
    console.warn('skip (bad json):', absPath, e.message);
    return [];
  }

  const out = [];
  const pushOne = (f) => {
    if (!f || !f.geometry) return;
    if (f.geometry.type === 'Polygon') {
      out.push(f);
    } else if (f.geometry.type === 'MultiPolygon') {
      const flat = turf.flatten(f);
      flat.features.forEach(ff => { if (ff.geometry?.type === 'Polygon') out.push(ff); });
    }
  };

  if (data.type === 'FeatureCollection' && Array.isArray(data.features)) {
    data.features.forEach(pushOne);
  } else if (data.type === 'Feature' && data.geometry) {
    pushOne(data);
  } else if (data.type === 'Polygon' || data.type === 'MultiPolygon') {
    pushOne(turf.feature(data));
  } else if (VERBOSE) {
    console.warn('skip (no polygons):', absPath);
  }

  // чистим/валидируем поштучно
  const res = [];
  for (const f of out) {
    try {
      const cleaned = turf.cleanCoords(f); // удаляет повторяющиеся точки, фиксы самозамыканий
      if (isPolygonFeatureValid(cleaned)) {
        res.push(cleaned);
      } else if (VERBOSE) {
        console.warn('drop invalid polygon:', path.basename(absPath));
      }
    } catch (e) {
      console.warn('drop (cleanCoords error):', path.basename(absPath), e.message);
    }
  }
  return res;
}

function keepOuters(feat) {
  const g = feat.geometry;
  if (g.type === 'Polygon') return turf.polygon([g.coordinates[0]]);
  if (g.type === 'MultiPolygon') {
    return turf.multiPolygon(g.coordinates.map(poly => [poly[0]]));
  }
  throw new Error('keepOuters(): unsupported ' + g.type);
}

function roundGeom(geom, prec) {
  const round = v => +Number(v).toFixed(prec);
  if (geom.type === 'Polygon') {
    geom.coordinates = geom.coordinates.map(r => r.map(([x, y]) => [round(x), round(y)]));
  } else if (geom.type === 'MultiPolygon') {
    geom.coordinates = geom.coordinates.map(poly => poly.map(r => r.map(([x, y]) => [round(x), round(y)])));
  }
  return geom;
}

(async () => {
  try {
    const files = [
      ...(await listGeojsonFiles(PARCELS_DIR)).map(f => path.join(PARCELS_DIR, f)),
      ...(await listGeojsonFiles(OTHER_DIR)).map(f => path.join(OTHER_DIR, f)),
    ];

    if (!files.length) {
      console.warn('Нет входных файлов.');
      return;
    }

    const allPolys = [];
    for (const fp of files) {
      const polys = await readPolygonsFromFile(fp);
      if (VERBOSE) console.log('+', path.basename(fp), 'polys:', polys.length);
      allPolys.push(...polys);
    }

    // финальная валидация (на всякий случай)
    const valid = allPolys.filter(isPolygonFeatureValid);
    if (!valid.length) {
      console.error('Нет валидных полигонов.');
      return;
    }

    const fc = turf.featureCollection(valid);

    // буферим FC (turf.buffer умеет FC), схлопываем и сжимаем
    const buffered   = turf.buffer(fc,  EPSILON_M,   { units: 'meters' });
    const dissolved  = turf.dissolve(buffered); // Feature (Polygon|MultiPolygon) ИЛИ FeatureCollection
    // если вдруг вернулся FC — схлопнем ещё раз
    const dissFeat = dissolved.type === 'FeatureCollection'
      ? turf.dissolve(dissolved)
      : dissolved;

    const contracted = turf.buffer(dissFeat, -EPSILON_M, { units: 'meters' });

    const outer = keepOuters(contracted);
    roundGeom(outer.geometry, PREC);

    const outFC = turf.featureCollection([
      turf.feature(outer.geometry, { name: 'parcels_outline', source: 'parcels+other', epsilon_m: EPSILON_M })
    ]);

    await fs.mkdir(OTHER_DIR, { recursive: true });
    const outPath = path.join(OTHER_DIR, OUT_NAME);
    await fs.writeFile(outPath, JSON.stringify(outFC, null, 2), 'utf8');
    console.log('✔ Граница сохранена:', outPath);

    // обновляем other/index.json
    const idxPath = path.join(OTHER_DIR, 'index.json');
    let lst = [];
    if (await exists(idxPath)) {
      try { lst = await readJson(idxPath); } catch {}
    }
    if (!Array.isArray(lst)) lst = [];
    if (!lst.includes(OUT_NAME)) {
      lst.push(OUT_NAME);
      await fs.writeFile(idxPath, JSON.stringify(lst, null, 2), 'utf8');
      console.log('✔ other/index.json обновлён');
    }
  } catch (e) {
    console.error('Ошибка:', e);
    process.exit(1);
  }
})();
