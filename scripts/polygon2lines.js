#!/usr/bin/env node
/* Convert GeoJSON Polygon/MultiPolygon -> LineString features (outer rings only) */
const fs = require('fs');

const inFile = process.argv[2];
const outFile = process.argv[3];
if (!inFile || !outFile) {
  console.error('Usage: node scripts/polygon2lines.js <in.json> <out.json>');
  process.exit(1);
}

const src = JSON.parse(fs.readFileSync(inFile, 'utf8'));
const out = { type: 'FeatureCollection', features: [] };

function ringToLineFeature(ring, props) {
  // гарантируем замыкание контура (последняя = первая)
  const needClose =
    ring.length &&
    (ring[0][0] !== ring[ring.length - 1][0] || ring[0][1] !== ring[ring.length - 1][1]);
  const closed = needClose ? [...ring, ring[0]] : ring;

  return {
    type: 'Feature',
    properties: {
      ...props,
      // заливка нам не нужна; оставим только stroke
      fillColor: undefined,
      fillOpacity: undefined,
      name: (props?.name ?? 'boundary') + '_outline',
    },
    geometry: { type: 'LineString', coordinates: closed },
  };
}

for (const f of src.features ?? []) {
  const props = f.properties ?? {};
  const g = f.geometry ?? {};
  if (!g.type || !g.coordinates) continue;

  if (g.type === 'Polygon') {
    const [outer] = g.coordinates;
    if (outer) out.features.push(ringToLineFeature(outer, props));
  } else if (g.type === 'MultiPolygon') {
    for (const poly of g.coordinates) {
      const [outer] = poly;
      if (outer) out.features.push(ringToLineFeature(outer, props));
    }
  } else {
    // другие типы оставляем как есть
    out.features.push(f);
  }
}

fs.writeFileSync(outFile, JSON.stringify(out, null, 2));
console.log(`✔ Converted → ${out.features.length} line feature(s)`);
console.log(`→ ${outFile}`);
