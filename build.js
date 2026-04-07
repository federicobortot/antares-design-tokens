import { readFileSync, writeFileSync, mkdirSync } from 'fs';

// ─── Config ───────────────────────────────────────────────────────────────────

const BRANDS = ['sisal', 'snai', 'pokerstars', 'sisalCasino'];
const MODES  = ['light', 'dark'];
const PREFIX = '';

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
    console.warn(`  ⚠ Riferimento non trovato: ${path}`);
    return ref;
  }

  // Nodo con value (token leaf o ambiguo)
  if (node && typeof node === 'object' && 'value' in node) {
    const val = node['value'];
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

function flattenTokens(obj, tree, prefix = '') {
  const result = {};
  for (const [key, val] of Object.entries(obj)) {
    // Salta chiavi meta
    if (['type', 'value', 'description', 'extensions'].includes(key)) continue;

    const fullKey = prefix ? `${prefix}-${key}` : key;

    if (val && typeof val === 'object') {
      const hasValue    = 'value' in val;
      const children    = Object.keys(val).filter(k => !['type', 'value', 'description', 'extensions'].includes(k));
      const hasChildren = children.length > 0;

      if (hasValue) {
        let resolved = val['value'];
        if (typeof resolved === 'string' && resolved.startsWith('{')) {
          resolved = resolveRef(resolved, tree);
        }
        result[fullKey] = { value: resolved, type: val['type'] ?? 'unknown' };
      }

      if (hasChildren) {
        Object.assign(result, flattenTokens(
          Object.fromEntries(children.map(k => [k, val[k]])),
          tree,
          fullKey
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
    .map(([key, { value }]) => `  --${PREFIX ? PREFIX + '-' : ''}${key}: ${value};`)
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

['dist/css', 'dist/scss', 'dist/ios', 'dist/android'].forEach(d => mkdirSync(d, { recursive: true }));

const primitives = loadJson('tokens/primitives.json');
const modeLight  = loadJson('tokens/mode.light.json');
const modeDark   = loadJson('tokens/mode.dark.json');
const component  = loadJson('tokens/component.json');

const brandFiles = {
  sisal:       loadJson('tokens/brand.sisal.json'),
  snai:        loadJson('tokens/brand.snai.json'),
  pokerstars:  loadJson('tokens/brand.pokerstars.json'),
  sisalCasino: loadJson('tokens/brand.sisalCasino.json'),
};

for (const brand of BRANDS) {
  for (const mode of MODES) {
    console.log(`\nBuilding ${brand}.${mode}...`);

    const modeTokens = mode === 'light' ? modeLight : modeDark;

    // tree serve solo come contesto di risoluzione dei riferimenti
    // flattenTokens riceve solo component, così l'output contiene esclusivamente token component
    const tree = deepMerge(primitives, brandFiles[brand], modeTokens, component);

    const flat = flattenTokens(component, tree);
    const count = Object.keys(flat).length;

    writeFileSync(`dist/css/${brand}.${mode}.css`,     serializeCss(flat, brand, mode),        'utf-8');
    writeFileSync(`dist/scss/${brand}.${mode}.scss`,   serializeScss(flat, brand, mode),       'utf-8');
    writeFileSync(`dist/ios/${brand}.${mode}.swift`,   serializeSwift(flat, brand, mode),      'utf-8');
    writeFileSync(`dist/android/${brand}.${mode}.xml`, serializeAndroidXml(flat, brand, mode), 'utf-8');

    console.log(`  ✓ ${count} token → CSS, SCSS, Swift, Android XML`);
  }
}

console.log('\n✅ Build completata.');
