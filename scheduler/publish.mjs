// Publie sur Instagram les posts dus de scheduler/queue.json.
// Lancé par .github/workflows/publish-instagram.yml (PC de Romain inutile).
// GitHub ne lance le robot que quelques fois par jour : à chaque lancement, il publie ce qui est dû,
// puis attend l'heure du post suivant tant qu'elle tombe dans les 5 h 20 du passage, et l'enregistre au fil de l'eau.
// DRY_RUN=1 : crée les conteneurs mais ne publie rien et ne modifie pas la file.
// Chaque post part aussi sur la page Facebook (sauf "facebook": false) et porte le lieu
// de la page (Saint-Germain-en-Laye) sauf "instagram.locationId": null.
// Texte alternatif optionnel : instagram.altText (image seule) ou instagram.altTexts[] (carrousel).
// Carrousel avec vidéos : instagram.carouselItems[] (voir createContainer) ; Facebook garde imageUrls.
import fs from "node:fs";
import { execSync } from "node:child_process";

const QUEUE = new URL("./queue.json", import.meta.url);
const G = "https://graph.facebook.com/v25.0";
const IG = "17841480595174504";
const PAGE = "1024824487379881"; // page Facebook Stratos, porte l'adresse du centre
const TOKEN = process.env.IG_PAGE_TOKEN;
const DRY = process.env.DRY_RUN === "1";
const ONLY = process.env.ONLY_ID || "";
const SUR_GITHUB = !!process.env.GITHUB_ACTIONS;
const DEBUT = Date.now();
const FENETRE = 320 * 60 * 1000; // le job GitHub est coupé à 6 h : on ne vise rien au-delà de 5 h 20
const ECART = 45 * 60 * 1000;    // au moins 45 min entre deux tentatives d'un même passage

if (!TOKEN) throw new Error("IG_PAGE_TOKEN manquant");

async function api(method, path, params = {}) {
  const body = new URLSearchParams({ ...params, access_token: TOKEN });
  const res = method === "GET"
    ? await fetch(`${G}/${path}?${body}`)
    : await fetch(`${G}/${path}`, { method, body });
  const json = await res.json();
  if (json.error) throw new Error(JSON.stringify(json.error));
  return json;
}

async function waitReady(id) {
  for (let i = 0; i < 60; i++) {
    await new Promise((r) => setTimeout(r, 5000));
    const { status_code } = await api("GET", id, { fields: "status_code" });
    console.log(`  conteneur ${id} : ${status_code}`);
    if (status_code === "FINISHED") return;
    if (status_code === "ERROR") throw new Error(`conteneur ${id} en erreur`);
  }
  throw new Error(`conteneur ${id} : délai dépassé`);
}

// Ajoute les champs optionnels sans jamais envoyer de valeur vide.
function extras(ig, altText) {
  const out = {};
  const loc = ig.locationId === undefined ? PAGE : ig.locationId;
  if (loc) out.location_id = loc;
  if (altText) out.alt_text = altText;
  return out;
}

async function createContainer(ig) {
  // Story vidéo : instagram.story = true (pas de légende, pas de sticker par l'API).
  if (ig.story) {
    const { id } = await api("POST", `${IG}/media`, { media_type: "STORIES", video_url: ig.videoUrl });
    await waitReady(id);
    return id;
  }
  if (ig.videoUrl) {
    // Couverture : instagram.thumbOffset = instant en millisecondes.
    const { id } = await api("POST", `${IG}/media`, { media_type: "REELS", video_url: ig.videoUrl, caption: ig.caption, ...(ig.thumbOffset ? { thumb_offset: String(ig.thumbOffset) } : {}), ...extras(ig) });
    await waitReady(id);
    return id;
  }
  if (ig.imageUrls.length === 1) {
    const { id } = await api("POST", `${IG}/media`, { image_url: ig.imageUrls[0], caption: ig.caption, ...extras(ig, ig.altText) });
    await waitReady(id);
    return id;
  }
  // Carrousel mixte photos + vidéos : instagram.carouselItems[] = { imageUrl } | { videoUrl }.
  // Sans carouselItems, imageUrls sert de carrousel (photos seules). imageUrls reste utilisé pour Facebook.
  const items = ig.carouselItems || ig.imageUrls.map((imageUrl) => ({ imageUrl }));
  const children = [];
  for (const [i, item] of items.entries()) {
    const alt = ig.altTexts?.[i];
    const media = item.videoUrl
      ? { media_type: "VIDEO", video_url: item.videoUrl }
      : { image_url: item.imageUrl, ...(alt ? { alt_text: alt } : {}) };
    const { id } = await api("POST", `${IG}/media`, { ...media, is_carousel_item: "true" });
    if (item.videoUrl) await waitReady(id);
    children.push(id);
  }
  const { id } = await api("POST", `${IG}/media`, { media_type: "CAROUSEL", children: children.join(","), caption: ig.caption, ...extras(ig) });
  await waitReady(id);
  return id;
}

// Même contenu sur la page Facebook : reel → Reel Facebook, image(s) → post photo.
async function publishFacebook(ig) {
  if (ig.videoUrl) {
    const { video_id, upload_url } = await api("POST", `${PAGE}/video_reels`, { upload_phase: "start" });
    const up = await fetch(upload_url, { method: "POST", headers: { Authorization: `OAuth ${TOKEN}`, file_url: ig.videoUrl } });
    const upJson = await up.json();
    if (!upJson.success) throw new Error(`upload reel Facebook : ${JSON.stringify(upJson)}`);
    await api("POST", `${PAGE}/video_reels`, { upload_phase: "finish", video_id, video_state: "PUBLISHED", description: ig.caption });
    return video_id;
  }
  if (ig.imageUrls.length === 1) {
    const { post_id, id } = await api("POST", `${PAGE}/photos`, { url: ig.imageUrls[0], caption: ig.caption });
    return post_id || id;
  }
  const media = {};
  for (const [i, url] of ig.imageUrls.entries()) {
    const { id } = await api("POST", `${PAGE}/photos`, { url, published: "false" });
    media[`attached_media[${i}]`] = JSON.stringify({ media_fbid: id });
  }
  const { id } = await api("POST", `${PAGE}/feed`, { message: ig.caption, ...media });
  return id;
}

// Garde-fou anti-doublon : un post récent avec le même début de légende = déjà en ligne.
async function alreadyLive(caption) {
  const { data } = await api("GET", `${IG}/media`, { fields: "id,caption,permalink", limit: "15" });
  const head = caption.slice(0, 60);
  return data.find((m) => (m.caption || "").startsWith(head));
}

function git(cmd) {
  try { execSync(cmd, { stdio: "inherit" }); } catch (e) { console.log(`  git : ${String(e.message).split("\n")[0]}`); }
}

// Sur GitHub : reprend la file à jour avant chaque passage, et pousse l'état après.
function synchroniser() {
  if (!DRY && SUR_GITHUB) git("git pull -q --rebase");
}

function enregistrer() {
  if (DRY || !SUR_GITHUB) return;
  git("git add scheduler/queue.json");
  git('git diff --cached --quiet || (git -c user.name="stratos-bot" -c user.email="stratos-bot@users.noreply.github.com" commit -q -m "scheduler: état de publication" && git pull -q --rebase && git push -q)');
}

let queue = null;
let derniere = 0; // heure de la dernière tentative de publication de ce lancement

async function passage() {
  synchroniser();
  queue = JSON.parse(fs.readFileSync(QUEUE, "utf-8"));
  const now = Date.now();
  const dus = queue.posts
    .filter((p) => p.status === "scheduled" && (ONLY ? p.id === ONLY : new Date(p.publishAt).getTime() <= now))
    .sort((a, b) => new Date(a.publishAt) - new Date(b.publishAt));
  // Un seul post par passage : deux posts en retard ne partent jamais à la même minute.
  const due = ONLY ? dus : dus.slice(0, 1);

  if (!due.length) console.log("Rien à publier.");

  for (const post of due) {
    console.log(`\n${post.id} (${post.publishAt})${DRY ? " [DRY RUN]" : ""}`);
    derniere = Date.now();
    try {
      const live = await alreadyLive(post.instagram.caption);
      if (live) {
        console.log(`  déjà en ligne : ${live.permalink}`);
        if (!DRY) Object.assign(post, { status: "published", mediaId: live.id, permalink: live.permalink, publishedAt: new Date().toISOString() });
      } else {
        const container = await createContainer(post.instagram);
        if (DRY) { console.log(`  OK, conteneur ${container} prêt (non publié)`); continue; }
        const { id } = await api("POST", `${IG}/media_publish`, { creation_id: container });
        // Déjà publié ici : une erreur de lecture du lien ne doit jamais relancer une publication.
        const permalink = await api("GET", id, { fields: "permalink" }).then((r) => r.permalink || "").catch(() => "");
        Object.assign(post, { status: "published", mediaId: id, permalink, publishedAt: new Date().toISOString() });
        if (post.facebook !== false) post.facebook = { status: "pending" };
        console.log(`  PUBLIÉ : ${permalink}`);
      }
    } catch (e) {
      console.log(`  ÉCHEC : ${e.message}`);
      if (!DRY) {
        post.attempts = (post.attempts || 0) + 1;
        post.lastError = e.message;
        if (post.attempts >= 3) post.status = "failed";
      }
    }
    if (!DRY) fs.writeFileSync(QUEUE, JSON.stringify(queue, null, 2) + "\n");
  }

  // Facebook après Instagram : un échec ici ne touche jamais au statut Instagram.
  const fbDue = DRY ? [] : queue.posts.filter((p) => p.facebook?.status === "pending" && (!ONLY || p.id === ONLY));
  for (const post of fbDue) {
    try {
      const id = await publishFacebook(post.instagram);
      Object.assign(post.facebook, { status: "published", id, publishedAt: new Date().toISOString() });
      console.log(`${post.id} : Facebook PUBLIÉ (${id})`);
    } catch (e) {
      console.log(`${post.id} : Facebook ÉCHEC : ${e.message}`);
      post.facebook.attempts = (post.facebook.attempts || 0) + 1;
      post.facebook.lastError = e.message;
      if (post.facebook.attempts >= 3) post.facebook.status = "failed";
    }
    fs.writeFileSync(QUEUE, JSON.stringify(queue, null, 2) + "\n");
  }
  enregistrer();
}

await passage();

// Attend l'heure du post suivant tant qu'elle tombe dans la fenêtre de ce lancement.
while (!ONLY && !DRY) {
  const dates = queue.posts.filter((p) => p.status === "scheduled").map((p) => new Date(p.publishAt).getTime()).sort((a, b) => a - b);
  if (!dates.length) break;
  const cible = Math.max(dates[0], derniere ? derniere + ECART : 0, Date.now());
  if (cible > DEBUT + FENETRE) {
    console.log(`\nProchain post le ${new Date(dates[0]).toISOString()} : pour un lancement suivant.`);
    break;
  }
  console.log(`\nJ'attends ${Math.round((cible - Date.now()) / 60000)} min, jusqu'à ${new Date(cible).toISOString()}.`);
  await new Promise((r) => setTimeout(r, Math.max(0, cible - Date.now()) + 5000));
  await passage();
}
