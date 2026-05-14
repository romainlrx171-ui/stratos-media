# Stratos — Blocks page Abonnements

Ensemble des blocks HTML embeddables au-dessus / autour du composant Wix Pricing Plans natif sur `/pricing-plans/list`.

Tous hébergés sur GitHub Pages. URL pattern :
`https://romainlrx171-ui.github.io/stratos-media/pages/abonnements-blocks/{nom}.html`

---

## 🟢 À ACTIVER MAINTENANT (audience restreinte, déjà venue au centre)

### `../abonnements-header-hormozi.html`
Block hero principal (au-dessus des plans). Bulle + titre + sub + photo Stratos #20 en fond.
**Position** : tout en haut, avant les cards Plans.

### `faq-minimal.html`
4 questions juridiquement/UX critiques (heures perdues, engagement 6 mois, résiliation, change formule).
**Position** : sous les cards Plans.

### `contact-help.html`
"Une question avant de souscrire ?" + boutons email + téléphone.
**Position** : tout en bas, après la FAQ.

⚠️ **Avant déploiement contact-help** : remplacer `tel:+33000000000` dans le HTML par le vrai numéro de téléphone Stratos.

---

## 🔵 PRÉPARÉS pour V2 GRAND PUBLIC (ne pas activer maintenant)

### `V2-masterclass-band.html`
Bandeau Masterclass Romain Leroux avec credentials (ELMS Ferrari GT3, Kessel Racing) + 3 stats.
**Position prévue** : entre hero et plans, ou entre plans et FAQ.

### `V2-testimonials.html`
3 cards témoignages clients (placeholders à remplacer par de vrais avis).
**Position prévue** : après FAQ.
**À faire avant activation** : collecter 3 vrais retours clients abonnés.

### `V2-alternative-decouverte.html`
Bandeau "Pas encore prêt ? Commence par une découverte" → lien vers `/offres-particuliers`.
**Position prévue** : tout en bas, après testimonials.
**Utile uniquement** quand on ouvre au grand public (audience cold) — inutile pour la phase restreinte.

---

## Workflow modification

1. Éditer le HTML local (ex: `faq-minimal.html`)
2. `git add . && git commit -m "..." && git push`
3. GitHub Pages rebuild en 1-2 min
4. La page Wix se refresh automatiquement (pas besoin de re-éditer Wix Editor)

## Workflow d'embed dans Wix

Pour chaque block à activer :
1. Wix Editor → page `/pricing-plans/list`
2. Sidebar → "Add Elements" → "Embed Code" → "Embed a Widget" → "Website Address (URL)"
3. Coller l'URL GitHub Pages du block
4. Width: Full width
5. Height: laisser auto (le script `postMessage` resize l'iframe selon le contenu)
6. Positionner avant/après les éléments existants
7. Publish

## Auto-resize iframe

Tous les blocks envoient leur hauteur au parent via `postMessage({type:'stratos-iframe-height',height:N})`.
Si Wix ne resize pas auto, ajouter ce code Velo sur la page :

```javascript
$w.onReady(function () {
  $w('#htmlAbonnements').onMessage((event) => {
    const data = event.data;
    if (data && data.type === 'stratos-iframe-height' && data.height) {
      $w('#htmlAbonnements').height = data.height + 20;
    }
  });
});
```
