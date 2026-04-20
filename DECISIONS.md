# Decisioni di progetto

Registro delle scelte non ovvie prese sul progetto, con motivazione.

---

## 1. Build system custom invece di Style Dictionary

**Decisione:** `build.js` scritto da zero, nessuna dipendenza esterna.

**Motivazione:** I token source hanno nodi che sono contemporaneamente gruppo e foglia — ad esempio esiste sia `color.text.neutral` (valore) sia `color.text.neutral.subtle` (valore figlio). Style Dictionary non supporta questa struttura e richiederebbe una trasformazione distruttiva dei sorgenti. Il build script custom gestisce nativamente i nodi ambigui emettendo entrambi.

---

## 2. L'output contiene solo token component

**Decisione:** `flattenTokens` riceve `component` come radice, non l'intero tree mergiato.

**Motivazione:** I file di output (CSS, SCSS, Swift, Android) sono pensati per essere consumati dai team di sviluppo che lavorano sui componenti. Esporre anche i token primitivi, brand e tema creerebbe rumore e renderebbe i file molto più grandi del necessario. I layer inferiori restano disponibili come contesto di risoluzione dei riferimenti ma non compaiono nell'output.

---

## 3. Nessun prefisso sulle variabili CSS

**Decisione:** `PREFIX = ''` — le variabili CSS sono nella forma `--button-color-brand-primary-bg-default`, non `--dt-button-...`.

**Motivazione:** Il prefisso `dt` non aggiungeva valore disambiguante significativo e allungava i nomi. Rimosso per mantenere i nomi il più compatti possibile.

---

## 4. I token numerici ricevono `px` automaticamente nell'output CSS/SCSS

**Decisione:** Nel serializer CSS/SCSS, `type === 'number'` produce `value + 'px'`.

**Motivazione:** I valori numerici nei token source sono espressi come numeri puri (es. `16`, `48`). Per essere valori CSS validi devono avere unità. L'aggiunta automatica di `px` è corretta per tutti i casi d'uso attuali (spacing, sizing, border). Se in futuro servissero unità diverse (es. `rem`, `em`) si valuterà l'aggiunta di un campo `unit` nel token source.

---

## 5. Token OS non risolti: scartati silenziosamente con conteggio

**Decisione:** I token che referenziano collezioni non caricate nel merge (es. `{viewportWidth}` da `os.android.json` / `os.ios.json`) vengono saltati senza produrre output invalido. Il build riporta il conteggio: `(ignorati N token OS non risolti)`.

**Motivazione:** I token dimensionali dipendenti dall'OS (es. `buttonGroup.size.sticky.width`) non hanno un valore unico cross-brand/mode: variano per piattaforma. Aggiungere una terza dimensione di build (brand × mode × os) è possibile ma non era prioritario. Per ora è preferibile escluderli dall'output piuttosto che produrre CSS invalido o warning rumorosi.

**Lavoro futuro:** quando la dimensione OS sarà necessaria, aggiungere `os.android.json` e `os.ios.json` al merge e generare file separati per piattaforma.

---

## 6. Output Tailwind: preset con CSS custom properties (approccio "runtime")

**Decisione:** L'output Tailwind sarà un singolo `dist/tailwind/tailwind.preset.js` in cui i valori fanno riferimento alle CSS vars già generate (`var(--token-name)`), non valori hardcoded.

**Motivazione:** L'architettura del progetto è multi-brand e multi-tema: il cambio di brand/tema avviene a runtime impostando gli attributi `data-brand` e `data-theme` sull'elemento root, che attiva il foglio CSS corrispondente. Un preset con CSS vars si integra nativamente in questo modello — un'unica build Tailwind funziona per tutti i brand. L'alternativa (8 preset hardcoded, uno per brand×mode) richiederebbe una rebuild separata per ogni combinazione, incompatibile con lo switching runtime.

**Alternativa scartata:** preset hardcoded per brand×mode — adatto solo a siti single-brand con build separate.

**Categorizzazione token numerici nel preset:**
- chiave contiene `radius` → `borderRadius`
- chiave contiene `border-width` → `borderWidth`
- altri token numerici → `spacing`

**Nomina utility classes:** verbatim dal nome del token (es. `bg-[button-color-brand-primary-bg-default]`). Convenzione da confermare con il primo progetto consumer.

**Stato:** implementato.

---

## 7. Token di tipografia: file separato con risoluzione tramite device file

**Decisione:** I token di tipografia (`typography.json`) sono un file autonomo, con struttura piatta (le chiavi radice sono gli stili: `d1`, `d2`, `h1`, ecc.). I valori di `fontSize` e `lineHeight` non sono hardcoded ma referenziano la scala dimensionale tramite file `device.mobile.json` e `device.desktop.json`, che forniscono i valori effettivi per ciascun breakpoint. I valori `fontFamily` sono referenziati dai file brand (es. `{typography.fontFamily.body}`).

**Motivazione:** Separare le dimensioni responsive (device file) dalla struttura dei token (typography.json) consente di modificare la scala tipografica per un breakpoint senza toccare la struttura token. Lo stesso meccanismo può essere esteso ad altri token che variano tra mobile e desktop senza aggiungere concetti nuovi al sistema.

---

## 8. Output CSS: struttura a tre sezioni con media query mobile-first

**Decisione:** I file CSS brand×tema hanno la seguente struttura:

```css
/* 1. Font-family scoped al brand */
:root[data-brand="X"] {
  --typography-d1-fontFamily: '...', sans-serif;
  ...
}

/* 2. Tutti i token component + tipografia (mobile-first, default) */
:root[data-brand="X"][data-theme="Y"] {
  --button-color-...: ...;
  --typography-d1-fontSize: 1.75rem;
  ...
}

/* 3. Solo i token che differiscono su desktop */
@media (min-width: 1024px) {
  :root[data-brand="X"][data-theme="Y"] {
    --typography-d1-fontSize: 2.625rem;
    ...
  }
}
```

**Motivazione:** Un singolo file per brand×tema evita richieste HTTP multiple. La sezione font-family è separata per permettere al browser di caricare i font prima che i token tema vengano applicati. Il blocco `@media` contiene solo i token che effettivamente differiscono tra mobile e desktop (nel caso attuale: 12 override tipografici su ~1265 token), minimizzando le ridondanze.

**Unità CSS per tipografia:** `fontSize` e `lineHeight` sono convertiti da numero puro a `rem` (divisione per 16). `fontWeight` è emesso come numero puro senza unità. Gli altri token numerici mantengono `px`.

**Breakpoint desktop:** `1024px`. Modificabile aggiornando la costante nel serializer `serializeResponsiveCss` in `build.js`.

---

## 9. Minificazione CSS: non implementata, valutare se necessario

**Decisione:** I file CSS in output non sono minificati. I file pesano ~61KB non compressi (~8–12KB con gzip/brotli).

**Motivazione:** Con la compressione HTTP attiva (standard su qualsiasi CDN o server moderno) il peso effettivo sul wire è comparabile a quello di una libreria UI leggera. Il costo non giustifica la complessità aggiuntiva nel build pipeline per i casi d'uso attuali.

**Lavoro futuro:** se dovesse servire (es. ambienti senza compressione HTTP, bundle size critico), aggiungere una fase di minificazione al termine del build che rimuova spazi e newline ridondanti, portando il file a ~35–38KB grezzo.

---

## 10. Token tipografici assenti dall'output Swift e Android XML ⚠ da rivedere

**Decisione:** I serializer Swift e Android XML ricevono solo `componentMobileFlat`. I token `typography.*` (fontSize, lineHeight, fontWeight, fontFamily) non compaiono nell'output nativo.

**Motivazione:** Scelta implicita al momento dell'implementazione: la tipografia responsiva era pensata per il web (CSS/SCSS). Non era ancora chiaro come mappare i token tipografici nei sistemi nativi, che hanno convenzioni molto diverse da CSS.

**Problemi aperti:**
- **Swift / SwiftUI:** come esporre i token? Opzioni: costanti `CGFloat` per fontSize/lineHeight, `Font.Weight` per fontWeight, `String` per fontFamily — oppure una struct `TextStyle` con tutti i campi raggruppati per stile (es. `SisalLightTokens.Typography.d1`).
- **Android XML:** `<dimen>` per fontSize/lineHeight in `sp` (non `dp`), `<string>` per fontFamily. I font-family però si gestiscono tipicamente con `font` resources e `TextAppearance` stili XML, non con semplici stringhe.
- In entrambi i casi: la dimensione responsive non ha equivalente nativo (non esiste `@media` in Swift/Android); bisognerà decidere se esporre solo i valori mobile, solo quelli desktop, o entrambi come costanti separate.

**Lavoro futuro:** prima di implementare, allinearsi con i team iOS e Android su quale struttura si aspettano di consumare.
