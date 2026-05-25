import { readFileSync, writeFileSync, mkdirSync, readdirSync, existsSync, unlinkSync } from 'fs';
import { join } from 'path';

// ─── Config ───────────────────────────────────────────────────────────────────

const TOKENS_DIR = 'tokens';
const PREFIX = '';
const OUTPUT_FORMATS = ['css', 'scss', 'ios', 'android', 'tailwind'];

// ─── Discovery ──────────────────────────────────────────────────────────────

// Un DS valido è una sottocartella con component.json o components.json
function discoverDs(tokensDir) {
  return readdirSync(tokensDir, { withFileTypes: true })
    .filter(e => {
      if (!e.isDirectory()) return false;
      try { readFileSync(join(tokensDir, e.name, 'component.json'));  return true; } catch {}
      try { readFileSync(join(tokensDir, e.name, 'components.json')); return true; } catch {}
      return false;
    })
    .map(e => e.name);
}

// Tutti i .json che non sono brand/mode/theme/os/component/device/typography → layer base (primitivi, alias, ecc.)
function discoverBaseFiles(dsDir) {
  return readdirSync(dsDir)
    .filter(f => f.endsWith('.json'))
    .filter(f =>
      !/^(brands?|modes?|themes?|os)\..+\.json$/.test(f) &&
      f !== 'component.json' && f !== 'components.json' &&
      !/\.(mobile|desktop)\.json$/.test(f) &&
      f !== 'typography.json'
    );
}

// Estrae i brand dai file brand.{name}.json o brands.{name}.json
function discoverBrands(dsDir) {
  return readdirSync(dsDir)
    .filter(f => /^brands?\..+\.json$/.test(f))
    .map(f => f.replace(/^brands?\./, '').replace(/\.json$/, ''));
}

// Estrae i mode dai file mode/modes/theme/themes.{name}.json
function discoverModes(dsDir) {
  return readdirSync(dsDir)
    .filter(f => /^(modes?|themes?)\..+\.json$/.test(f))
    .map(f => f.replace(/^(modes?|themes?)\./, '').replace(/\.json$/, ''));
}

// Carica typography.json se presente
function discoverTypographyFile(dsDir) {
  try { return loadJson(join(dsDir, 'typography.json')); } catch { return null; }
}

// Carica i file device.mobile.json e device.desktop.json se presenti
function discoverBreakpointFiles(dsDir) {
  const files = readdirSync(dsDir).filter(f => f.endsWith('.json'));
  const mobileFile  = files.find(f => /\.mobile\.json$/.test(f));
  const desktopFile = files.find(f => /\.desktop\.json$/.test(f));
  if (!mobileFile || !desktopFile) return {};
  return {
    mobile:  loadJson(join(dsDir, mobileFile)),
    desktop: loadJson(join(dsDir, desktopFile)),
  };
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

function flattenTokens(obj, tree, prefix = '', _skipped = { count: 0 }, _unresolved = [], _context = 'default') {
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
        if (typeof resolved === 'string' && resolved.startsWith('{')) {
          _skipped.count++;
          _unresolved.push({
            context: _context,
            token: fullKey,
            reference: resolved,
          });
          continue;
        }
        result[fullKey] = { value: resolved, type: val['$type'] ?? val['type'] ?? 'unknown' };
      }

      if (hasChildren) {
        Object.assign(result, flattenTokens(
          Object.fromEntries(children.map(k => [k, val[k]])),
          tree,
          fullKey,
          _skipped
          ,
          _unresolved,
          _context
        ));
      }
    }
  }
  return result;
}

function buildUnresolvedTokensReport(allDesignSystems) {
  const escapeTableCell = (value) => String(value).replace(/\|/g, '\\|');
  const generatedAt = new Date().toISOString();
  const total = allDesignSystems.reduce(
    (sum, dsEntry) => sum + dsEntry.variants.reduce((variantSum, entry) => variantSum + entry.items.length, 0),
    0
  );
  const lines = [
    `UNRESOLVED TOKENS REPORT`,
    `======================`,
    `Generato: ${generatedAt}`,
    ``,
  ];

  if (total === 0) {
    lines.push(`Nessun token non interpolato trovato durante la build.`);
    lines.push(``);
    return lines.join('\n');
  }

  lines.push(`Token non interpolati trovati: ${total}`);
  lines.push(``);

  for (const dsEntry of allDesignSystems) {
    const dsTotal = dsEntry.variants.reduce((sum, entry) => sum + entry.items.length, 0);
    lines.push(`Design system: ${dsEntry.ds}`);
    lines.push(`Token non interpolati: ${dsTotal}`);
    lines.push(``);

    for (const entry of dsEntry.variants) {
      if (entry.items.length === 0) continue;

      lines.push(`${entry.brand}.${entry.mode}`);
      lines.push(`----------------`);
      lines.push(``);
      lines.push(`| context | token | reference |`);
      lines.push(`| --- | --- | --- |`);

      for (const item of entry.items) {
        lines.push(`| ${escapeTableCell(item.context)} | ${escapeTableCell(item.token)} | ${escapeTableCell(item.reference)} |`);
      }

      lines.push(``);
    }

    lines.push(``);
  }

  return lines.join('\n');
}

function writeUnresolvedTokensReport(distDir, allDesignSystems) {
  const report = buildUnresolvedTokensReport(allDesignSystems);
  writeFileSync(join(distDir, 'UNRESOLVED_TOKENS.txt'), report, 'utf-8');
}

function removeLegacyPerFormatReports(distDs) {
  for (const format of OUTPUT_FORMATS) {
    const legacyTxtPath = join(distDs, format, 'UNRESOLVED_TOKENS.txt');
    if (existsSync(legacyTxtPath)) {
      unlinkSync(legacyTxtPath);
    }

    const legacyReadmePath = join(distDs, format, 'README.md');
    if (existsSync(legacyReadmePath)) {
      unlinkSync(legacyReadmePath);
    }
  }
}

// ─── Serializers ──────────────────────────────────────────────────────────────

function serializeCss(flat, brand, mode) {
  const selector = `:root[data-brand="${brand}"][data-theme="${mode}"]`;
  const vars = Object.entries(flat)
    .map(([key, { value, type }]) => `  --${PREFIX ? PREFIX + '-' : ''}${key}: ${type === 'number' ? value + 'px' : value};`)
    .join('\n');
  return `${selector} {\n${vars}\n}\n`;
}

function serializeResponsiveCss(mainFlat, desktopOverrides, fontFamilyVars, brand, mode) {
  const REM_KEYS = ['fontSize', 'lineHeight'];

  function formatValue(key, value, type) {
    const seg = key.split('-').pop();
    if (REM_KEYS.includes(seg) && type === 'number') return `${value / 16}rem`;
    if (seg === 'fontWeight' && type === 'number') return String(value);
    return type === 'number' ? value + 'px' : value;
  }

  const parts = [];

  // Section 1: font-family vars scoped to brand only
  if (Object.keys(fontFamilyVars).length > 0) {
    const ffVars = Object.entries(fontFamilyVars)
      .map(([key, { value }]) => `  --${key}: '${value}', sans-serif;`)
      .join('\n');
    parts.push(`:root[data-brand="${brand}"] {\n${ffVars}\n}\n`);
  }

  // Section 2: mobile-first defaults (component + typography, no fontFamily)
  const mainSelector = `:root[data-brand="${brand}"][data-theme="${mode}"]`;
  const mainVars = Object.entries(mainFlat)
    .map(([key, { value, type }]) => `  --${key}: ${formatValue(key, value, type)};`)
    .join('\n');
  parts.push(`${mainSelector} {\n${mainVars}\n}\n`);

  // Section 3: desktop overrides inside media query
  if (Object.keys(desktopOverrides).length > 0) {
    const desktopVars = Object.entries(desktopOverrides)
      .map(([key, { value, type }]) => `    --${key}: ${formatValue(key, value, type)};`)
      .join('\n');
    parts.push(`@media (min-width: 1024px) {\n  ${mainSelector} {\n${desktopVars}\n  }\n}\n`);
  }

  return parts.join('\n');
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

const unresolvedByDs = [];

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
  for (const fmt of OUTPUT_FORMATS) {
    mkdirSync(join('dist', ds, fmt), { recursive: true });
  }

  const distDs = join('dist', ds);
  removeLegacyPerFormatReports(distDs);
  const unresolvedByVariant = [];

  // Carica file condivisi del DS
  const baseFiles = discoverBaseFiles(dsDir);
  const primitives = baseFiles.length > 0
    ? deepMerge(...baseFiles.map(f => loadJson(join(dsDir, f))))
    : {};
  if (baseFiles.length > 0) console.log(`  Base:  ${baseFiles.join(', ')}`);
  let component;
  try { component = loadJson(join(dsDir, 'component.json')); }
  catch { component = loadJson(join(dsDir, 'components.json')); }

  const brandFiles = {};
  for (const brand of brands) {
    let brandFile;
    try { brandFile = loadJson(join(dsDir, `brand.${brand}.json`)); }
    catch { brandFile = loadJson(join(dsDir, `brands.${brand}.json`)); }
    brandFiles[brand] = brandFile;
  }
  const modeFiles = {};
  for (const mode of modes) {
    // Support mode/modes/theme/themes.{name}.json
    const candidates = [`mode.${mode}.json`, `modes.${mode}.json`, `theme.${mode}.json`, `themes.${mode}.json`];
    let modeFile;
    for (const c of candidates) {
      try { modeFile = loadJson(join(dsDir, c)); break; } catch {}
    }
    if (!modeFile) throw new Error(`Nessun file mode trovato per "${mode}" in ${dsDir}`);
    modeFiles[mode] = modeFile;
  }

  const typographyJson  = discoverTypographyFile(dsDir);
  const breakpointFiles = discoverBreakpointFiles(dsDir);
  const hasBreakpoints  = !!(breakpointFiles.mobile && breakpointFiles.desktop);
  if (typographyJson) console.log(`  Typography: typography.json`);
  if (hasBreakpoints) console.log(`  Breakpoints: device.mobile.json + device.desktop.json`);

  let tailwindWritten = false;

  for (const brand of brands) {
    for (const mode of modes) {
      console.log(`\n  Building ${brand}.${mode}...`);

      // Build resolution trees: mobile (default) and desktop
      const mobileTree = hasBreakpoints
        ? deepMerge(primitives, brandFiles[brand], modeFiles[mode], breakpointFiles.mobile)
        : deepMerge(primitives, brandFiles[brand], modeFiles[mode]);
      const desktopTree = hasBreakpoints
        ? deepMerge(primitives, brandFiles[brand], modeFiles[mode], breakpointFiles.desktop)
        : null;

      // Component tokens
      const skipped = { count: 0 };
      const unresolvedTokens = [];
      const componentMobileFlat  = flattenTokens(component, mobileTree,  '', skipped, unresolvedTokens, 'component.mobile');
      const componentDesktopFlat = desktopTree
        ? flattenTokens(component, desktopTree, '', { count: 0 }, unresolvedTokens, 'component.desktop')
        : componentMobileFlat;

      // Typography tokens (optional)
      let typographyMobileFlat  = {};
      let typographyDesktopFlat = {};
      let fontFamilyVars = {};

      if (typographyJson) {
        typographyMobileFlat  = flattenTokens(typographyJson, mobileTree,  'typography', { count: 0 }, unresolvedTokens, 'typography.mobile');
        typographyDesktopFlat = desktopTree
          ? flattenTokens(typographyJson, desktopTree, 'typography', { count: 0 }, unresolvedTokens, 'typography.desktop')
          : typographyMobileFlat;

        // Extract fontFamily tokens → brand-scoped :root block
        for (const [key, val] of Object.entries(typographyMobileFlat)) {
          if (key.endsWith('-fontFamily')) fontFamilyVars[key] = val;
        }
        for (const key of Object.keys(fontFamilyVars)) {
          delete typographyMobileFlat[key];
          delete typographyDesktopFlat[key];
        }
      }

      // Merged mobile-first flat + desktop overrides (only tokens that differ)
      const mainFlat   = { ...componentMobileFlat,  ...typographyMobileFlat  };
      const desktopAll = { ...componentDesktopFlat, ...typographyDesktopFlat };
      const desktopOverrides = {};
      for (const [key, val] of Object.entries(desktopAll)) {
        if (!mainFlat[key] || mainFlat[key].value !== val.value) {
          desktopOverrides[key] = val;
        }
      }

      const count  = Object.keys(mainFlat).length;

      writeFileSync(join(distDs, 'css',     `${brand}.${mode}.css`),
        serializeResponsiveCss(mainFlat, desktopOverrides, fontFamilyVars, brand, mode), 'utf-8');
      writeFileSync(join(distDs, 'scss',    `${brand}.${mode}.scss`),
        serializeResponsiveCss(mainFlat, desktopOverrides, fontFamilyVars, brand, mode), 'utf-8');
      writeFileSync(join(distDs, 'ios',     `${brand}.${mode}.swift`),
        serializeSwift(componentMobileFlat, brand, mode), 'utf-8');
      writeFileSync(join(distDs, 'android', `${brand}.${mode}.xml`),
        serializeAndroidXml(componentMobileFlat, brand, mode), 'utf-8');

      if (!tailwindWritten) {
        writeFileSync(join(distDs, 'tailwind', 'tailwind.preset.js'), serializeTailwindPreset(mainFlat), 'utf-8');
        tailwindWritten = true;
      }

      unresolvedByVariant.push({
        brand,
        mode,
        items: unresolvedTokens,
      });

      const skippedMsg = skipped.count > 0 ? ` (ignorati ${skipped.count} token OS non risolti)` : '';
      const desktopMsg = Object.keys(desktopOverrides).length > 0
        ? ` + ${Object.keys(desktopOverrides).length} desktop overrides` : '';
      console.log(`    ✓ ${count} token → CSS/SCSS${desktopMsg}, Swift, Android XML, Tailwind preset${skippedMsg}`);
    }
  }

  unresolvedByDs.push({
    ds,
    variants: unresolvedByVariant,
  });
}

writeUnresolvedTokensReport('dist', unresolvedByDs);

console.log('\n✅ Build completata.');
