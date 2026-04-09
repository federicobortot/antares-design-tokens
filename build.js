import { readFileSync, writeFileSync, mkdirSync, readdirSync } from 'fs';
import { join } from 'path';

// ─── Config ───────────────────────────────────────────────────────────────────

const TOKENS_DIR = 'tokens';
const PREFIX = '';

// ─── Discovery ──────────────────────────────────────────────────────────────

// Un DS valido è una sottocartella con component.json
function discoverDs(tokensDir) {
  return readdirSync(tokensDir, { withFileTypes: true })
    .filter(e => {
      if (!e.isDirectory()) return false;
      try {
        readFileSync(join(tokensDir, e.name, 'component.json'));
        return true;
      } catch { return false; }
    })
    .map(e => e.name);
}

// Tutti i .json che non sono brand/mode/os/component → layer base (primitivi, alias, ecc.)
function discoverBaseFiles(dsDir) {
  return readdirSync(dsDir)
    .filter(f => f.endsWith('.json'))
    .filter(f => !/^(brand|mode|os)\..+\.json$/.test(f) && f !== 'component.json');
}

// Estrae i brand dai file brand.{name}.json
function discoverBrands(dsDir) {
  return readdirSync(dsDir)
    .filter(f => /^brand\..+\.json$/.test(f))
    .map(f => f.replace(/^brand\./, '').replace(/\.json$/, ''));
}

// Estrae i mode dai file mode.{name}.json
function discoverModes(dsDir) {
  return readdirSync(dsDir)
    .filter(f => /^mode\..+\.json$/.test(f))
    .map(f => f.replace(/^mode\./, '').replace(/\.json$/, ''));
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function loadJson(path) {
  return JSON.parse(readFileSync(path, 'utf-8'));
}

function deepMerge(...objects) {
  const result = {};
  for (const obj of objects) {
    for (const [key, val] of Object.entries(obj)) {
      if (val && typeof val === 'object' && !Array.isArray(val) && result[key] && typeof result[key] === 'object') {
        result[key] = deepMerge(result[key], val);
      } else {
        result[key] = val;
      }
    }
  }
  return result;
}

function getByPath(obj, path) {
  const parts = path.split('.');
  let cur = obj;
  for (const p of parts) {
    if (cur === undefined || cur === null) return undefined;
    cur = cur[p];
  }
  return cur;
}

function resolveRef(ref, tree, visited = new Set()) {
  const path = ref.replace(/^\{|\}$/g, '');
  if (visited.has(path)) {
    console.warn(`  ⚠ Riferimento circolare: ${path}`);
    return ref;
  }
  visited.add(path);

  const node = getByPath(tree, path);
  if (node === undefined) {
    return ref; // lasciato non risolto, verrà scartato in flattenTokens
  }

  // Nodo con value (token leaf o ambiguo) — supporta sia 'value' che '$value' (DTCG W3C)
  if (node && typeof node === 'object' && ('value' in node || '$value' in node)) {
    const val = node['$value'] ?? node['value'];
    if (typeof val === 'string' && val.startsWith('{')) {
      return resolveRef(val, tree, visited);
    }
    return val;
  }

  // Valore scalare diretto
  if (typeof node !== 'object') return node;

  console.warn(`  ⚠ Path non è un token leaf: ${path}`);
  return ref;
}

function flattenTokens(obj, tree, prefix = '', _skipped = { count: 0 }) {
  const result = {};
  const META_KEYS = ['type', '$type', 'value', '$value', 'description', '$description', 'extensions', '$extensions'];

  for (const [key, val] of Object.entries(obj)) {
    // Salta chiavi meta
    if (META_KEYS.includes(key)) continue;

    const fullKey = prefix ? `${prefix}-${key}` : key;

    if (val && typeof val === 'object') {
      const hasValue    = 'value' in val || '$value' in val;
      const children    = Object.keys(val).filter(k => !META_KEYS.includes(k));
      const hasChildren = children.length > 0;

      if (hasValue) {
        let resolved = val['$value'] ?? val['value'];
        if (typeof resolved === 'string' && resolved.startsWith('{')) {
          resolved = resolveRef(resolved, tree);
        }
        // Scarta token con riferimenti non risolti (es. collezione OS non caricata)
        if (typeof resolved === 'string' && resolved.startsWith('{')) { _skipped.count++; continue; }
        result[fullKey] = { value: resolved, type: val['$type'] ?? val['type'] ?? 'unknown' };
      }

      if (hasChildren) {
        Object.assign(result, flattenTokens(
          Object.fromEntries(children.map(k => [k, val[k]])),
          tree,
          fullKey,
          _skipped
        ));
      }
    }
  }
  return result;
}

// ─── Serializers ──────────────────────────────────────────────────────────────

function serializeCss(flat, brand, mode) {
  const selector = `:root[data-brand="${brand}"][data-theme="${mode}"]`;
  const vars = Object.entries(flat)
    .map(([key, { value, type }]) => `  --${PREFIX ? PREFIX + '-' : ''}${key}: ${type === 'number' ? value + 'px' : value};`)
    .join('\n');
  return `${selector} {\n${vars}\n}\n`;
}

// TODO: chiedere ai dev se preferiscono variabili SCSS ($var) invece di custom properties (--var)
function serializeScss(flat, brand, mode) {
  return serializeCss(flat, brand, mode);
}

// TODO: chiedere ai dev se preferiscono UIKit (UIColor) invece di SwiftUI (Color)
// TODO: chiedere se preferiscono enum, extension o struct
function serializeSwift(flat, brand, mode) {
  const structName = `${capitalize(brand)}${capitalize(mode)}Tokens`;
  const props = Object.entries(flat).map(([key, { value, type }]) => {
    const swiftName = toCamelCase(key);
    if (type === 'color') {
      const color = hexToSwiftColor(value);
      if (!color) return `  // ⚠ valore colore non parsabile: ${key} = ${value}`;
      return `  static let ${swiftName} = Color(red: ${color.r}, green: ${color.g}, blue: ${color.b}, opacity: ${color.a})`;
    }
    if (type === 'dimension' || type === 'number') {
      const num = parseFloat(value);
      return `  static let ${swiftName}: CGFloat = ${isNaN(num) ? `/* ${value} */` : num}`;
    }
    return `  static let ${swiftName} = "${value}"`;
  }).join('\n');

  return [
    `import SwiftUI`,
    ``,
    `// Brand: ${brand} | Mode: ${mode}`,
    `// Generato automaticamente — non modificare manualmente`,
    `struct ${structName} {`,
    props,
    `}`,
    ``,
  ].join('\n');
}

function serializeTailwindPreset(flat) {
  const colors = {};
  const spacing = {};
  const borderRadius = {};
  const borderWidth = {};

  for (const [key, { type }] of Object.entries(flat)) {
    const cssVar = `var(--${PREFIX ? PREFIX + '-' : ''}${key})`;
    if (type === 'color') {
      colors[key] = cssVar;
    } else if (type === 'number') {
      if (key.includes('radius')) {
        borderRadius[key] = cssVar;
      } else if (key.includes('border-width')) {
        borderWidth[key] = cssVar;
      } else {
        spacing[key] = cssVar;
      }
    }
  }

  const toJs = (obj) => {
    const entries = Object.entries(obj)
      .map(([k, v]) => `      '${k}': '${v}'`)
      .join(',\n');
    return entries ? `{\n${entries}\n    }` : '{}';
  };

  return [
    `// Tailwind CSS preset — generato automaticamente, non modificare manualmente`,
    `// Usa variabili CSS definite in dist/css/*.css`,
    `// Richiede che il file CSS del brand/tema attivo sia caricato nel progetto`,
    `/** @type {import('tailwindcss').Config} */`,
    `module.exports = {`,
    `  theme: {`,
    `    extend: {`,
    `      colors: ${toJs(colors)},`,
    `      spacing: ${toJs(spacing)},`,
    `      borderRadius: ${toJs(borderRadius)},`,
    `      borderWidth: ${toJs(borderWidth)},`,
    `    },`,
    `  },`,
    `};`,
    ``,
  ].join('\n');
}

// TODO: chiedere ai dev se preferiscono Compose (MaterialTheme) invece di XML resources
function serializeAndroidXml(flat, brand, mode) {
  const lines = Object.entries(flat).map(([key, { value, type }]) => {
    const name = toSnakeCase(key);
    if (type === 'color') {
      const hex8 = toAndroidHex(value);
      if (!hex8) return `  <!-- ⚠ valore colore non parsabile: ${key} = ${value} -->`;
      return `  <color name="${name}">${hex8}</color>`;
    }
    if (type === 'dimension' || type === 'number') {
      return `  <dimen name="${name}">${value}</dimen>`;
    }
    return `  <string name="${name}">${value}</string>`;
  }).join('\n');

  return [
    `<?xml version="1.0" encoding="utf-8"?>`,
    `<!-- Brand: ${brand} | Mode: ${mode} -->`,
    `<!-- Generato automaticamente — non modificare manualmente -->`,
    `<resources>`,
    lines,
    `</resources>`,
    ``,
  ].join('\n');
}

// ─── Utilities ────────────────────────────────────────────────────────────────

function parseRgba(str) {
  const m = typeof str === 'string' && str.match(/^rgba?\(\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\s*\)$/);
  if (!m) return null;
  return {
    r: (parseFloat(m[1]) / 255).toFixed(4),
    g: (parseFloat(m[2]) / 255).toFixed(4),
    b: (parseFloat(m[3]) / 255).toFixed(4),
    a: m[4] !== undefined ? parseFloat(m[4]).toFixed(4) : '1.0',
  };
}

function hexToSwiftColor(hex) {
  if (typeof hex !== 'string') return null;
  const rgba = parseRgba(hex);
  if (rgba) return rgba;
  const clean = hex.replace('#', '');
  if (clean.length === 6) {
    return {
      r: (parseInt(clean.slice(0,2), 16)/255).toFixed(4),
      g: (parseInt(clean.slice(2,4), 16)/255).toFixed(4),
      b: (parseInt(clean.slice(4,6), 16)/255).toFixed(4),
      a: '1.0'
    };
  }
  if (clean.length === 8) {
    return {
      r: (parseInt(clean.slice(0,2), 16)/255).toFixed(4),
      g: (parseInt(clean.slice(2,4), 16)/255).toFixed(4),
      b: (parseInt(clean.slice(4,6), 16)/255).toFixed(4),
      a: (parseInt(clean.slice(6,8), 16)/255).toFixed(4),
    };
  }
  return null;
}

// CSS è #RRGGBBAA, Android vuole #AARRGGBB
function toAndroidHex(hex) {
  if (typeof hex !== 'string') return null;
  const rgba = parseRgba(hex);
  if (rgba) {
    const toHex = f => Math.round(parseFloat(f) * 255).toString(16).padStart(2, '0');
    const rr = Math.round(parseFloat(rgba.r) * 255).toString(16).padStart(2, '0');
    const gg = Math.round(parseFloat(rgba.g) * 255).toString(16).padStart(2, '0');
    const bb = Math.round(parseFloat(rgba.b) * 255).toString(16).padStart(2, '0');
    const aa = Math.round(parseFloat(rgba.a) * 255).toString(16).padStart(2, '0');
    return `#${aa}${rr}${gg}${bb}`.toUpperCase();
  }
  const clean = hex.replace('#', '');
  if (clean.length === 6) return `#FF${clean.toUpperCase()}`;
  if (clean.length === 8) {
    const [rr, gg, bb, aa] = [clean.slice(0,2), clean.slice(2,4), clean.slice(4,6), clean.slice(6,8)];
    return `#${aa}${rr}${gg}${bb}`.toUpperCase();
  }
  return null;
}

function toCamelCase(str) {
  return str.replace(/-([a-z0-9])/gi, (_, c) => c.toUpperCase());
}

function toSnakeCase(str) {
  return str.replace(/-/g, '_').toLowerCase();
}

function capitalize(str) {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// ─── Build ────────────────────────────────────────────────────────────────────

const dsList = discoverDs(TOKENS_DIR);

if (dsList.length === 0) {
  console.error(`❌ Nessun Design System trovato in '${TOKENS_DIR}/'. Ogni DS deve avere primitives.json e component.json.`);
  process.exit(1);
}

console.log(`\nDesign System trovati: ${dsList.join(', ')}`);

for (const ds of dsList) {
  const dsDir = join(TOKENS_DIR, ds);
  const brands = discoverBrands(dsDir);
  const modes  = discoverModes(dsDir);

  console.log(`\n━━━ ${ds} ━━━`);
  console.log(`  Brand: ${brands.join(', ')}`);
  console.log(`  Mode:  ${modes.join(', ')}`);

  if (brands.length === 0) { console.warn(`  ⚠ Nessun brand trovato, skip.`); continue; }
  if (modes.length === 0)  { console.warn(`  ⚠ Nessun mode trovato, skip.`);  continue; }

  // Crea directory di output per questo DS
  for (const fmt of ['css', 'scss', 'ios', 'android', 'tailwind']) {
    mkdirSync(join('dist', ds, fmt), { recursive: true });
  }

  // Carica file condivisi del DS
  const baseFiles = discoverBaseFiles(dsDir);
  const primitives = baseFiles.length > 0
    ? deepMerge(...baseFiles.map(f => loadJson(join(dsDir, f))))
    : {};
  if (baseFiles.length > 0) console.log(`  Base:  ${baseFiles.join(', ')}`);
  const component  = loadJson(join(dsDir, 'component.json'));

  const brandFiles = {};
  for (const brand of brands) {
    brandFiles[brand] = loadJson(join(dsDir, `brand.${brand}.json`));
  }
  const modeFiles = {};
  for (const mode of modes) {
    modeFiles[mode] = loadJson(join(dsDir, `mode.${mode}.json`));
  }

  let tailwindWritten = false;

  for (const brand of brands) {
    for (const mode of modes) {
      console.log(`\n  Building ${brand}.${mode}...`);

      // tree serve solo come contesto di risoluzione dei riferimenti
      // flattenTokens riceve solo component, così l'output contiene esclusivamente token component
      const tree = deepMerge(primitives, brandFiles[brand], modeFiles[mode], component);

      const skipped = { count: 0 };
      const flat = flattenTokens(component, tree, '', skipped);
      const count = Object.keys(flat).length;

      const distDs = join('dist', ds);
      writeFileSync(join(distDs, 'css',     `${brand}.${mode}.css`),  serializeCss(flat, brand, mode),        'utf-8');
      writeFileSync(join(distDs, 'scss',    `${brand}.${mode}.scss`), serializeScss(flat, brand, mode),       'utf-8');
      writeFileSync(join(distDs, 'ios',     `${brand}.${mode}.swift`),serializeSwift(flat, brand, mode),      'utf-8');
      writeFileSync(join(distDs, 'android', `${brand}.${mode}.xml`),  serializeAndroidXml(flat, brand, mode), 'utf-8');

      if (!tailwindWritten) {
        writeFileSync(join(distDs, 'tailwind', 'tailwind.preset.js'), serializeTailwindPreset(flat), 'utf-8');
        tailwindWritten = true;
      }

      const skippedMsg = skipped.count > 0 ? ` (ignorati ${skipped.count} token OS non risolti)` : '';
      console.log(`    ✓ ${count} token → CSS, SCSS, Swift, Android XML, Tailwind preset${skippedMsg}`);
    }
  }
}

console.log('\n✅ Build completata.');
