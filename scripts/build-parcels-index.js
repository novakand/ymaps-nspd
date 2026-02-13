#!/usr/bin/env node
/* eslint-disable no-console */
//node scripts/build-parcels-index.js
const fs = require('fs/promises');
const path = require('path');

const PARCELS_DIR = path.resolve(__dirname, '../projects/app/src/assets/data/parcels');
const OUT = path.join(PARCELS_DIR, 'index.json');

(async () => {
  const files = (await fs.readdir(PARCELS_DIR))
    .filter(n => /\.(geo)?json$/i.test(n))
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));

  await fs.writeFile(OUT, JSON.stringify(files, null, 2), 'utf8');
  console.log('parcels index written:', OUT, `(${files.length} files)`);
})();
