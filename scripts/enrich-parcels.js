#!/usr/bin/env node
/* eslint-disable no-console */
//node scripts/enrich-parcels.js
const fs = require('fs/promises');
const path = require('path');

const PARCELS_DIR = path.resolve(__dirname, '../projects/app/src/assets/data/parcels');
const R = 6378137; // меркатор

// ---- CLI ----
const argv = process.argv.slice(2);
const arg = (name, def) => {
  const i = argv.findIndex(a => a === name || a.startsWith(name + '='));
  if (i === -1) return def;
  const v = argv[i].includes('=') ? argv[i].split('=').slice(1).join('=') : argv[i + 1];
  return v === undefined ? true : v;
};

const DIR = path.resolve(arg('--dir', PARCELS_DIR));
const STATUS_MAP_PATH = arg('--status-map');          // путь к JSON с заданными статусами (опц.)
const DEFAULT_STATUS = String(arg('--default-status', 'free')); // free|sold|reserved
const DRY = !!arg('--dry', false);

// ---- статусы (можно править здесь под фирменные цвета) ----
const STATUS_DICT = {
  free:     { label: 'свободно',       color: '#2ECC71' }, // зелёный
  sold:     { label: 'продано',        color: '#E74C3C' }, // красный
  reserved: { label: 'забронировано',  color: '#F1C40F' }, // жёлтый
};

// ---- утилиты площади ----
function lonLatToMerc([lon, lat]) {
  const x = R * (lon * Math.PI / 180);
  const y = R * Math.log(Math.tan(Math.PI / 4 + (lat * Math.PI / 180) / 2));
  return [x, y];
}

function ringAreaXY(ring) {
  // Shoelace; ring — массив [x,y]
  let s = 0;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [x1, y1] = ring[j];
    const [x2, y2] = ring[i];
    s += (x1 * y2 - x2 * y1);
  }
  return Math.abs(s) / 2;
}

function polygonAreaMercator(coords) {
  // coords: [ [ [x,y],... ], [hole], ... ]
  if (!coords?.length) return 0;
  const outer = ringAreaXY(coords[0]);
  const holes = coords.slice(1).reduce((sum, hole) => sum + ringAreaXY(hole), 0);
  return Math.max(0, outer - holes);
}

function polygonAreaFromGeometry(geom, crsName) {
  if (!geom) return 0;

  // помогаем себе: если не 3857, переводим lon/lat в меркатор и считаем в метрах
  const toXY = (pt) => (crsName === 'EPSG:3857' ? pt : lonLatToMerc(pt));

  if (geom.type === 'Polygon') {
    const xy = geom.coordinates.map(ring => ring.map(toXY));
    return polygonAreaMercator(xy);
  }
  if (geom.type === 'MultiPolygon') {
    let sum = 0;
    for (const poly of geom.coordinates) {
      const xy = poly.map(ring => ring.map(toXY));
      sum += polygonAreaMercator(xy);
    }
    return sum;
  }
  return 0;
}

// ---- чтение статус-карты (опц.) ----
async function readStatusMap(file) {
  if (!file) return null;
  try {
    const abs = path.resolve(file);
    const raw = await fs.readFile(abs, 'utf8');
    const data = JSON.parse(raw);
    // ожидаемый формат:
    // { "01": "sold", "015": "reserved", "40:03:011005:713": "sold" }
    return data;
  } catch (e) {
    console.warn('Не удалось прочитать status-map:', file, e.message);
    return null;
  }
}

function resolveStatus(props, filenameBase, map, fallback) {
  // приоритеты: карта по имени файла -> карта по cad_num -> уже задано -> дефолт
  const cad = props?.options?.cad_num || props?.externalKey || props?.label;
  const fromMap =
    (map && (map[filenameBase] || map[String(filenameBase).padStart(2, '0')] || (cad && map[cad]))) ||
    null;

  const s = fromMap || props?.status || fallback || 'free';
  return ['free','sold','reserved'].includes(s) ? s : 'free';
}

// ---- основной проход ----
(async () => {
  const statusMap = await readStatusMap(STATUS_MAP_PATH);

  const files = (await fs.readdir(DIR))
    .filter(n => /\.json$/i.test(n) && n !== 'index.json')
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  if (!files.length) {
    console.log('Файлов не найдено в', DIR);
    return;
  }

  let updated = 0;

  for (const file of files) {
    const full = path.join(DIR, file);
    const base = path.basename(file, path.extname(file));

    let json;
    try {
      json = JSON.parse(await fs.readFile(full, 'utf8'));
    } catch (e) {
      console.warn('Ошибка чтения JSON:', file, e.message);
      continue;
    }

    const features = Array.isArray(json?.features) ? json.features : [];
    let changed = false;

    for (const f of features) {
      if (!f.properties) f.properties = {};
      const props = f.properties;

      // name
      if (props.name !== base) {
        props.name = base;
        changed = true;
      }

      // area: сначала options.specified_area, иначе по геометрии
      const crsName = f?.geometry?.crs?.properties?.name || (json?.crs?.properties?.name);
      const specified = Number(props?.options?.specified_area);
      const area =
        Number.isFinite(specified) && specified > 0
          ? specified
          : Math.round(polygonAreaFromGeometry(f.geometry, crsName));
      if (props.area !== area && Number.isFinite(area)) {
        props.area = area; // м²
        changed = true;
      }

      // status + label + color
      const status = resolveStatus(props, base, statusMap, DEFAULT_STATUS);
      const cur = STATUS_DICT[status] || STATUS_DICT.free;

      if (props.status !== status) { props.status = status; changed = true; }
      if (props.statusLabel !== cur.label) { props.statusLabel = cur.label; changed = true; }
      if (props.statusColor !== cur.color) { props.statusColor = cur.color; changed = true; }
    }

    if (changed) {
      updated++;
      if (!DRY) {
        await fs.writeFile(full, JSON.stringify(json, null, 2), 'utf8');
      }
      console.log(`${DRY ? '[dry] ' : ''}Updated: ${file}`);
    }
  }

  console.log(`${DRY ? 'Проверено' : 'Обновлено'} файлов:`, updated, 'из', files.length);
})();
