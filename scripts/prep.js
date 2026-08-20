// Pre-generates all 365 catalog projects into data/work/_catalog so every
// repo is staged and ready to push. Run with: npm run prep
const fs = require('fs');
const path = require('path');
const CATALOG = require('../content/catalog');
const { GENERATORS } = require('../content/generators');
const { WORK_DIR } = require('../server/config');

const stageDir = path.join(WORK_DIR, '_catalog');
fs.mkdirSync(stageDir, { recursive: true });

let total = 0;
for (const cat of CATALOG) {
  const def = {
    id: cat.id,
    title: cat.title,
    slug: cat.slug,
    module: cat.module,
    jsName: cat.jsName,
    category: cat.category,
    blurb: cat.blurb,
    tagline: cat.blurb,
    stack: cat.stack,
    platform: cat.platform,
    generatorId: cat.generatorId
  };
  const gen = GENERATORS[def.generatorId];
  const dir = path.join(stageDir, def.slug);
  const files = gen.generator(def, dir);
  for (const [fp, content] of files) {
    fs.mkdirSync(path.dirname(fp), { recursive: true });
    fs.writeFileSync(fp, content);
  }
  total += files.length;
}
console.log(`staged ${CATALOG.length} projects (${total} files) in ${stageDir}`);
