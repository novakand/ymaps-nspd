#!/usr/bin/env node
/* eslint-disable no-console */
const fs   = require('fs/promises');
const path = require('path');
const turf = require('@turf/turf');

// --- CLI ---
const argv = process.argv.slice(2);
const arg = (k, def) => {
  const a = argv.find(s => s === k || s.startsWith(k + '='));
  if (!a) return def;
  return a.includes('=') ? a.split('=').slice(1).join('=') : true;
};

// ВХОД/ВЫХОД
const IN_PATH  = path.resolve(
  __dirname,
  arg('--in', '../projects/app/src/assets/data/border.json')   // твой файл
);
const OUT_PATH = path.resolve(
  __dirname,
  arg('--out', '../projects/app/src/assets/data/border.single.json')
);

// на сколько «распухнуть/сжать» для склейки (метры)
const EPSILON_M = Number(arg('--epsilon', 1));
const PREC      = Number(arg('--prec', 6)); // округление координат

// --- утилиты ---
const readJson = async p => JSON.parse(await fs.readFile(p, 'utf8'));

function collectPolygons(g) {
  // на входе Feature|FeatureCollection|Geometry → массив Polygon-features
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

  if (g?.type === 'FeatureCollection') g.features.forEach(pushOne);
  else if (g?.type === 'Feature') pushOne(g);
  else if (g?.type === 'Polygon' || g?.type === 'MultiPolygon') pushOne(turf.feature(g));

  // чистим и фильтруем пустые
  return out
    .map(f => turf.cleanCoords(f))
    .filter(f => {
      const rings = f.geometry?.coordinates;
      return Array.isArray(rings) && rings.length && Array.isArray(rings[0]) && rings[0].length >= 4;
    });
}

function keepOuters(feat) {
  // удаляем внутренние кольца: оставляем только внешние
  const g = feat.geometry;
  if (g.type === 'Polygon') return turf.polygon([g.coordinates[0]]);
  if (g.type === 'MultiPolygon') {
    return turf.multiPolygon(g.coordinates.map(poly => [poly[0]]));
  }
  throw new Error('keepOuters(): unsupported ' + g.type);
}

function roundGeom(geom, prec) {
  const r = v => +Number(v).toFixed(prec);
  if (geom.type === 'Polygon') {
    geom.coordinates = geom.coordinates.map(ring => ring.map(([x, y]) => [r(x), r(y)]));
  } else if (geom.type === 'MultiPolygon') {
    geom.coordinates = geom.coordinates.map(poly =>
      poly.map(ring => ring.map(([x, y]) => [r(x), r(y)]))
    );
  }
  return geom;
}

// --- main ---
(async () => {
  try {
    const input = await readJson(IN_PATH);
    const polys = collectPolygons(input);
    if (!polys.length) {
      console.error('Не нашёл полигонов во входном файле:', IN_PATH);
      process.exit(1);
    }

    // 1) склейка: buffer(+ε) → dissolve → buffer(-ε)
    const fc = turf.featureCollection(polys);
    const buffered   = EPSILON_M ? turf.buffer(fc,  EPSILON_M,   { units: 'meters' }) : fc;
    let dissolved    = turf.dissolve(buffered);
    if (dissolved.type === 'FeatureCollection') dissolved = turf.dissolve(dissolved);
    const contracted = EPSILON_M ? turf.buffer(dissolved, -EPSILON_M, { units: 'meters' }) : dissolved;

    // 2) если вдруг остался FC — превратим в единую MultiPolygon
    let single = contracted;
    if (single.type === 'FeatureCollection') {
      single = turf.combine(single).features[0]; // -> Feature<MultiPolygon>
    }

    // 3) выкинуть внутренние кольца и округлить
    const outer = keepOuters(single);
    roundGeom(outer.geometry, PREC);
    outer.properties = { name: 'parcels_outline_single', source: 'border.json', epsilon_m: EPSILON_M };

    const outFC = turf.featureCollection([outer]);
    await fs.writeFile(OUT_PATH, JSON.stringify(outFC, null, 2), 'utf8');
    console.log('✔ Готово:', OUT_PATH);
  } catch (e) {
    console.error('Ошибка:', e);
    process.exit(1);
  }
})();
