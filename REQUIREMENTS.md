# Requisiti funzionali

Descrizione dei requisiti del sistema di build dei design token dal punto di vista dell'utente (designer / sviluppatore).

---

## 1. Struttura sorgente dei token

- **RF-01** Il sistema deve supportare più Design System (DS) all'interno della stessa repository, ciascuno in una sottocartella dedicata sotto `tokens/`.
- **RF-02** Un DS è riconosciuto automaticamente se la sua cartella contiene un file di componenti (`component.json` o `components.json`).
- **RF-03** Ogni DS può avere uno o più file brand (`brand.{name}.json` o `brands.{name}.json`).
- **RF-04** Ogni DS può avere uno o più file mode/tema (`mode.{name}.json`, `modes.{name}.json`, `theme.{name}.json`, `themes.{name}.json`).
- **RF-05** Ogni DS può avere zero o più file base (primitive, alias, ecc.) — qualsiasi file `.json` che non sia un file brand, mode, os, component, device o typography.
- **RF-06** I token seguono il formato W3C DTCG, con chiavi `$type` e `$value` (o equivalenti senza `$`).
- **RF-07** I riferimenti tra token usano la sintassi `{path.to.token}` e devono essere risolti in cascata (riferimenti a riferimenti).

---

## 2. Tipografia responsiva

- **RF-08** Un DS può opzionalmente includere un file `typography.json` che definisce gli stili tipografici (es. `d1`, `h1`, `p.regular`, ecc.).
- **RF-09** I valori di `fontSize` e `lineHeight` nei token tipografici sono referenziati tramite file di breakpoint. Il build accetta qualsiasi file il cui nome termini in `.mobile.json` e `.desktop.json` (convenzione attuale: `device.mobile.json` / `device.desktop.json`).
- **RF-10** I valori di `fontFamily` nei token tipografici sono referenziati dai file brand.
- **RF-11** Se i file `device.mobile.json` e `device.desktop.json` sono presenti, il sistema deve applicare i valori mobile come default e i valori desktop in un `@media (min-width: 1024px)`.
- **RF-12** Il blocco `@media` deve contenere **solo** i token i cui valori differiscono tra mobile e desktop — nessuna ridondanza.

---

## 3. Output CSS/SCSS

- **RF-13** Per ogni combinazione brand × mode, il sistema genera un file CSS e un file SCSS. Il contenuto SCSS è attualmente identico al CSS (usa custom properties `--var`, non variabili SCSS `$var`). *(open question: da confermare con i team consumer — vedi TODO in `build.js`)*
- **RF-14** Il file CSS ha la seguente struttura a tre sezioni:
  1. `:root[data-brand="X"]` — variabili `fontFamily` per il brand
  2. `:root[data-brand="X"][data-theme="Y"]` — tutti i token component e tipografici (mobile-first)
  3. `@media (min-width: 1024px)` — solo i token che differiscono tra mobile e desktop
- **RF-15** I token numerici rappresentanti dimensioni sono emessi con unità `px`.
- **RF-16** I token `fontSize` e `lineHeight` sono convertiti in `rem` (divisione per 16).
- **RF-17** I token `fontWeight` sono emessi come numero puro, senza unità.
- **RF-18** I valori `fontFamily` sono emessi nella forma `'NomeFont', sans-serif`.
- **RF-19** I token con riferimenti non risolvibili (es. dipendenti da `os.android.json` / `os.ios.json` non caricati) sono scartati silenziosamente; il build riporta il conteggio a console.

---

## 4. Output Swift (iOS)

- **RF-20** Per ogni combinazione brand × mode viene generato un file `.swift` con una struct SwiftUI di costanti tipizzate (`Color`, `CGFloat`, `String`). Il nome della struct segue la convenzione `{Brand}{Mode}Tokens`. *(open question: UIKit vs SwiftUI, struct vs enum vs extension — vedi TODO in `build.js`)*
- **RF-21** L'output Swift include solo i token **component** con valori mobile. I token tipografici non sono inclusi nell'output Swift/iOS.

---

## 5. Output Android XML

- **RF-22** Per ogni combinazione brand × mode viene generato un file XML di risorse Android (`<color>`, `<dimen>`, `<string>`). *(open question: Compose/MaterialTheme vs XML resources — vedi TODO in `build.js`)*
- **RF-23** I colori sono convertiti nel formato Android `#AARRGGBB`. I valori `rgba()` sono supportati.
- **RF-24** L'output Android include solo i token **component** con valori mobile. I token tipografici non sono inclusi nell'output Android.

---

## 6. Output Tailwind

- **RF-25** Viene generato un singolo `tailwind.preset.js` per DS, basato sul primo brand × mode processato.
- **RF-26** I valori del preset fanno riferimento alle CSS custom properties (`var(--token-name)`) invece di essere hardcoded, in modo da funzionare a runtime con qualsiasi brand/tema attivo.
- **RF-27** I token vengono categorizzati automaticamente: `color` → `colors`, `number` con `radius` → `borderRadius`, `number` con `border-width` → `borderWidth`, altri `number` → `spacing`.

---

## 7. Comportamento del build

- **RF-28** Il build è eseguito con `node build.js` (o `npm run build`).
- **RF-29** Il build rileva automaticamente tutti i DS presenti in `tokens/` senza configurazione esplicita.
- **RF-30** I file di output sono scritti in `dist/{ds-name}/{formato}/`, creando le cartelle se non esistono.
- **RF-31** Il build stampa a console un riepilogo per ogni DS e ogni combinazione brand × mode: numero di token generati, numero di desktop override, numero di token scartati.
- **RF-32** Se un DS non ha brand o mode riconoscibili, viene saltato con un avviso a console senza interrompere il build degli altri DS.
- **RF-33** I token dell'output contengono **solo** i token component (e tipografici se presenti) — i token primitivi e alias non compaiono nell'output finale.
