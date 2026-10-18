// Publie sur Instagram les posts dus de scheduler/queue.json.
// Lancé toutes les 10 min par .github/workflows/publish-instagram.yml (PC de Romain inutile).
// DRY_RUN=1 : crée les conteneurs mais ne publie rien et ne modifie pas la file.
import fs from "node:fs";

const QUEUE = new URL("./queue.json", import.meta.url);
const G = "https://graph.facebook.com/v25.0";
const IG = "17841480595174504";
const TOKEN = process.env.IG_PAGE_TOKEN;
const DRY = process.env.DRY_RUN === "1";
const ONLY = process.env.ONLY_ID || "";

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

async function createContainer(ig) {
  if (ig.videoUrl) {
    const { id } = await api("POST", `${IG}/media`, { media_type: "REELS", video_url: ig.videoUrl, caption: ig.caption });
    await waitReady(id);
    return id;
  }
  if (ig.imageUrls.length === 1) {
    const { id } = await api("POST", `${IG}/media`, { image_url: ig.imageUrls[0], caption: ig.caption });
    await waitReady(id);
    return id;
  }
  const children = [];
  for (const url of ig.imageUrls) {
    const { id } = await api("POST", `${IG}/media`, { image_url: url, is_carousel_item: "true" });
    children.push(id);
  }
  const { id } = await api("POST", `${IG}/media`, { media_type: "CAROUSEL", children: children.join(","), caption: ig.caption });
  await waitReady(id);
  return id;
}

// Garde-fou anti-doublon : un post récent avec le même début de légende = déjà en ligne.
async function alreadyLive(caption) {
  const { data } = await api("GET", `${IG}/media`, { fields: "id,caption,permalink", limit: "15" });
  const head = caption.slice(0, 60);
  return data.find((m) => (m.caption || "").startsWith(head));
}

const queue = JSON.parse(fs.readFileSync(QUEUE, "utf-8"));
const now = Date.now();
const due = queue.posts.filter((p) =>
  p.status === "scheduled" && (ONLY ? p.id === ONLY : new Date(p.publishAt).getTime() <= now));

if (!due.length) console.log("Rien à publier.");

for (const post of due) {
  console.log(`\n${post.id} (${post.publishAt})${DRY ? " [DRY RUN]" : ""}`);
  try {
    const live = await alreadyLive(post.instagram.caption);
    if (live) {
      console.log(`  déjà en ligne : ${live.permalink}`);
      if (!DRY) Object.assign(post, { status: "published", mediaId: live.id, permalink: live.permalink, publishedAt: new Date().toISOString() });
    } else {
      const container = await createContainer(post.instagram);
      if (DRY) { console.log(`  OK, conteneur ${container} prêt (non publié)`); continue; }
      const { id } = await api("POST", `${IG}/media_publish`, { creation_id: container });
      const { permalink } = await api("GET", id, { fields: "permalink" });
      Object.assign(post, { status: "published", mediaId: id, permalink, publishedAt: new Date().toISOString() });
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
