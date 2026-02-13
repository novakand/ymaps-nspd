#!/usr/bin/env node
/* eslint-disable no-console */
'use strict';

/**
 * Пройдётся по всем *.json в DEFAULT_DIR (рекурсивно),
 * для каждого Feature в FeatureCollection:
 *  - добавит/обновит style-поля в properties:
 *      strokeColor:"", strokeOpacity:"0", strokeWeight:"",
 *      fillColor:"#40643b", fillOpacity:"0.9"
 *  - удалит properties.status и properties.statusColor
 *  - установит properties.statusLabel = "Свободно"
 *
 * Опции:
 *   --dir=/abs/or/relative/path   (по умолчанию DEFAULT_DIR)
 *   --dry                         (только показать изменения, файлы не писать)
 *   --backup                      (сделать .bak один раз перед перезаписью)
 */

const fs = require('fs');
const path = require('path');

const DEFAULT_DIR = path.resolve(__dirname, '../projects/map-element/src/assets/data/parcels');

const args = process.argv.slice(2);
const dirArg = args.find(a => a.startsWith('--dir='));
const DRY = args.includes('--dry');
const MAKE_BACKUP = args.includes('--backup');
const ROOT = dirArg ? path.resolve(process.cwd(), dirArg.split('=')[1]) : DEFAULT_DIR;

const STYLE_DEFAULTS = {
    labelButton: "Бронировать",
    urlButton:"https://forms.amocrm.ru/rwxcwlc",
    price:null
};

let filesScanned = 0;
let filesChanged = 0;
let featuresTouched = 0;

main().catch(err => {
    console.error('❌ Ошибка:', err);
    process.exit(1);
});

async function main() {
    const files = listJsonFiles(ROOT);
    if (files.length === 0) {
        console.warn('⚠️  JSON-файлы не найдены в', ROOT);
        return;
    }

    for (const file of files) {
        filesScanned++;
        const before = fs.readFileSync(file, 'utf8');
        let changed = false;
        let data;

        try {
            data = JSON.parse(before);
        } catch (e) {
            console.warn('⚠️  Пропускаю (невалидный JSON):', file);
            continue;
        }

        // обрабатываем FeatureCollection
        if (data && data.type === 'FeatureCollection' && Array.isArray(data.features)) {
            let localTouched = 0;
            data.features = data.features.map(feat => {
                if (!feat || feat.type !== 'Feature') return feat;

                const props = feat.properties ?? (feat.properties = {});
                let modifiedHere = false;

                // добавить / обновить стилевые поля
                for (const [k, v] of Object.entries(STYLE_DEFAULTS)) {
                    if (props[k] !== v) {
                        props[k] = v;
                        modifiedHere = true;
                    }
                }

               
                // if ('status' in props) {
                //     delete props.status;
                //     modifiedHere = true;
                // }
                // if ('statusColor' in props) {
                //     delete props.statusColor;
                //     modifiedHere = true;
                // }

                // выставить статус-лейбл (с заглавной)
                // if (props.statusLabel !== 'Свободно') {
                //     props.statusLabel = 'Свободно';
                //     modifiedHere = true;
                // }

                if (modifiedHere) {
                    localTouched++;
                }
                return feat;
            });

            if (localTouched > 0) {
                changed = true;
                featuresTouched += localTouched;
            }
        }

        if (changed) {
            filesChanged++;
            if (DRY) {
                console.log(`🔎 [dry] Изменился бы: ${rel(file)} (features: +${featuresTouched})`);
            } else {
                if (MAKE_BACKUP) {
                    const bak = file + '.bak';
                    if (!fs.existsSync(bak)) {
                        fs.copyFileSync(file, bak);
                    }
                }
                const after = JSON.stringify(data, null, 2) + '\n';
                fs.writeFileSync(file, after, 'utf8');
                console.log(`💾 Обновлён: ${rel(file)}`);
            }
        }
    }

    console.log('\n✅ Готово.');
    console.log(`Файлов просканировано: ${filesScanned}`);
    console.log(`Файлов изменено:      ${filesChanged}`);
    console.log(`Фич затронуто:        ${featuresTouched}`);
}

function listJsonFiles(dir) {
    const out = [];
    walk(dir, out);
    // только .json, без .bak, .bakXXXX и т.п.
    return out.filter(f => f.endsWith('.json'));
}

function walk(dir, out) {
    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const e of entries) {
        // пропускаем явные бэкапы/лишние
        if (e.name.endsWith('.bak') || e.name.includes('.bak')) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
            walk(full, out);
        } else if (e.isFile()) {
            out.push(full);
        }
    }
}

function rel(p) {
    return path.relative(process.cwd(), p) || p;
}
