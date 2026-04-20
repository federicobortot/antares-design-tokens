# TODO — 6 aperti

Elenco di tutto ciò che è rimasto aperto, da fare o da decidere. Aggiornare il conteggio nell'intestazione ad ogni modifica.

---

## Decisioni tecniche da prendere con i team consumer

- [ ] **TODO-01** — **SCSS: `$var` o `--var`?**
  L'output SCSS è attualmente identico al CSS (usa custom properties `--token`). Chiedere ai team frontend se preferiscono variabili SCSS native (`$button-color-primary: ...`) invece delle custom properties.
  → _vedi `build.js` riga ~211, `DECISIONS.md` punto 6, `REQUIREMENTS.md` RF-13_

- [ ] **TODO-02** — **Swift: UIKit o SwiftUI? struct, enum o extension?**
  Il serializer Swift genera una `struct` con `Color` (SwiftUI). Chiedere ai team iOS se preferiscono `UIColor` (UIKit), e quale pattern di accesso: `struct`, `enum` o `extension`.
  → _vedi `build.js` riga ~216, `DECISIONS.md` punto 10, `REQUIREMENTS.md` RF-20_

- [ ] **TODO-03** — **Android: XML resources o Compose/MaterialTheme?**
  Il serializer Android genera XML (`<color>`, `<dimen>`, `<string>`). Chiedere ai team Android se preferiscono un approccio Compose con `MaterialTheme`.
  → _vedi `build.js` riga ~293, `DECISIONS.md` punto 10, `REQUIREMENTS.md` RF-22_

---

## Funzionalità mancanti

- [ ] **TODO-04** — **Tipografia in Swift e Android**
  I token `typography.*` (fontSize, lineHeight, fontWeight, fontFamily) sono presenti nell'output CSS/SCSS ma assenti dall'output Swift e Android XML. Da implementare una volta deciso il formato (vedi TODO-02 e TODO-03) e allineati con i team nativi su come gestire l'assenza di breakpoint responsive.
  → _vedi `DECISIONS.md` punto 10_

- [ ] **TODO-05** — **Output OS-specifico (android / ios)**
  I token dipendenti da `os.android.json` / `os.ios.json` vengono attualmente scartati silenziosamente (es. `buttonGroup.size.sticky.width`). Se i team nativi ne hanno bisogno, aggiungere la terza dimensione di build brand × mode × os e generare file separati per piattaforma.
  → _vedi `DECISIONS.md` punto 5_

---

## Ottimizzazioni facoltative

- [ ] **TODO-06** — **Minificazione CSS/SCSS**
  I file CSS pesano ~61KB non compressi. Se dovesse servire in ambienti senza compressione HTTP, aggiungere una fase di minificazione al build (~35–38KB grezzo risultante).
  → _vedi `DECISIONS.md` punto 9_
