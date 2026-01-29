// content.js (MV3) - tinder.com/app/recs*
// START -> chrome.storage state -> refresh once -> wait UI -> loop
// Each iteration: Open Profile -> wait 1s -> read profile -> (NOPE if filters fail) else LIKE
//
// Filters from chrome.storage.local 'tal_settings':
// - Age range (if enabled)
// - Max distance km (if enabled)
// - Min pictures (if enabled, best-effort)
// - Banned keywords in About me (if enabled)
//
// Trace: writes to chrome.storage.local key 'tal_log' (last ~60 entries)

const DEFAULT_SETTINGS = {
  ageEnabled: true, ageMin: 25, ageMax: 35,
  distEnabled: true, maxKm: 50,
  picsEnabled: false, minPics: 2,
  kwEnabled: true, bannedKeywords: []
};

const STATE_KEY = "tal_state";        // { running: bool, needRefresh: bool }
const LOG_KEY = "tal_log";
const MAX_LOG = 60;

let isRunning = false;
let settings = { ...DEFAULT_SETTINGS };

function sleep(ms){ return new Promise(r=>setTimeout(r, ms)); }

async function appendLog(message){
  const ts = Date.now();
  const { [LOG_KEY]: cur } = await chrome.storage.local.get(LOG_KEY);
  const arr = Array.isArray(cur) ? cur : [];
  arr.push({ ts, message });
  await chrome.storage.local.set({ [LOG_KEY]: arr.slice(-MAX_LOG) });
}

async function pressKey(key){
  // Dispatch key events on the document (Tinder supports keyboard shortcuts)
  const target = document.activeElement || document.body || document.documentElement;
  const opts = { key, code: key, bubbles: true, cancelable: true };
  target.dispatchEvent(new KeyboardEvent("keydown", opts));
  target.dispatchEvent(new KeyboardEvent("keyup", opts));
  await sleep(80);
}

async function pressNope(){
  await pressKey("ArrowLeft");
}

async function pressLike(){
  await pressKey("ArrowRight");
}

function safeClick(el){
  if(!el) return false;
  try{
    const btn = el.closest("button,[role='button'],a") || el;
    btn.scrollIntoView({behavior:"instant", block:"center"});
    btn.click();
    return true;
  }catch(e){
    console.warn("[Tinder Auto Like] click failed", e);
    return false;
  }
}

function findByLabelOrText(text){
  const t = String(text).trim().toLowerCase();
  const aria = [...document.querySelectorAll("button[aria-label],[role='button'][aria-label]")]
    .find(e => (e.getAttribute("aria-label")||"").trim().toLowerCase().includes(t));
  if(aria) return aria;

  return [...document.querySelectorAll("button,[role='button'],a")]
    .find(e => (e.textContent||"").trim().toLowerCase().includes(t)) || null;
}

/* ---------- overlays ---------- */

function isOverlayPresent(){
  return Boolean(
    document.querySelector('[role="dialog"][aria-modal="true"]') ||
    document.querySelector('[aria-modal="true"]') ||
    document.querySelector('div[class*="modal" i]')
  );
}

function findCloseInDialog(){
  const dialog =
    document.querySelector('[role="dialog"][aria-modal="true"]') ||
    document.querySelector('[aria-modal="true"]');
  if(!dialog) return null;

  const byClass = dialog.querySelector('button[class*="close" i]');
  if(byClass) return byClass;

  for(const b of dialog.querySelectorAll("button,[role='button']")){
    const hidden = b.querySelector("span.Hidden");
    const tt = (hidden?.textContent || b.textContent || "").trim().toLowerCase();
    if(tt === "close" || tt.includes("close")) return b;
  }
  return dialog.querySelector("button,[role='button']") || null;
}

async function dismissOverlayOnce(){
  const closeBtn = findCloseInDialog();
  if(closeBtn){
    safeClick(closeBtn);
    await sleep(300);
    await appendLog("Closed overlay dialog");
    return true;
  }

  document.dispatchEvent(new KeyboardEvent("keydown", {key:"Escape", bubbles:true}));
  document.dispatchEvent(new KeyboardEvent("keyup", {key:"Escape", bubbles:true}));
  await sleep(200);

  const generic =
    findByLabelOrText("no thanks") ||
    findByLabelOrText("not interested") ||
    findByLabelOrText("maybe later") ||
    findByLabelOrText("later") ||
    findByLabelOrText("skip") ||
    findByLabelOrText("got it") ||
    findByLabelOrText("ok") ||
    findByLabelOrText("close");
  if(generic){
    safeClick(generic);
    await sleep(250);
    await appendLog("Dismissed overlay (generic)");
    return true;
  }
  return false;
}

/* ---------- storage ---------- */

async function loadSettings(){
  const { tal_settings } = await chrome.storage.local.get("tal_settings");
  const s = Object.assign({}, DEFAULT_SETTINGS, tal_settings || {});
  s.ageMin = Math.max(18, Math.min(75, Number(s.ageMin)||25));
  s.ageMax = Math.max(18, Math.min(75, Number(s.ageMax)||35));
  if(s.ageMin > s.ageMax) [s.ageMin, s.ageMax] = [s.ageMax, s.ageMin];
  s.maxKm = Math.max(1, Math.min(150, Number(s.maxKm)||50));
  s.minPics = Math.max(1, Math.min(10, Number(s.minPics)||2));
  s.bannedKeywords = Array.isArray(s.bannedKeywords) ? s.bannedKeywords : [];
  return s;
}

async function loadState(){
  const { tal_state } = await chrome.storage.local.get(STATE_KEY);
  return Object.assign({ running:false, needRefresh:false }, tal_state || {});
}

async function saveState(state){
  await chrome.storage.local.set({ [STATE_KEY]: state });
}

/* ---------- profile parsing ---------- */

function normalizeText(s){ return String(s || "").toLowerCase(); }

function getAboutMeText(){
  const headings = [...document.querySelectorAll("h1,h2,h3,div[role='heading']")];
  const aboutHeading = headings.find(h => normalizeText(h.textContent) === "about me");
  if(!aboutHeading) return "";

  const card = aboutHeading.closest("div");
  if(!card) return "";

  const texts = [...card.querySelectorAll("div")]
    .map(d => (d.textContent||"").trim())
    .filter(Boolean)
    .filter(t => normalizeText(t) !== "about me");

  texts.sort((a,b)=>b.length-a.length);
  return texts[0] || "";
}

function compactAbout(about){
  const s = String(about || "").replace(/\s+/g, " ").trim();
  if(!s) return "";
  const max = 60;
  return s.length > max ? (s.slice(0, max-1) + "…") : s;
}


function getDistanceKm(){
  const nodes = [...document.querySelectorAll("div,span,li,p")];
  for(const el of nodes){
    const txt = (el.textContent||"").trim();
    if(!txt) continue;

    let m = txt.match(/(\d+)\s*(kilometers?|km)\s+away/i);
    if(m) return parseInt(m[1],10);

    m = txt.match(/(\d+)\s*(kilometers?|km)\b/i);
    if(m && /away/i.test(txt)) return parseInt(m[1],10);
  }
  return null;
}

function getAge(){
  const candidates = [...document.querySelectorAll("h1,h2,h3")]
    .map(h => (h.textContent||"").trim())
    .filter(Boolean);
  for(const t of candidates){
    const m = t.match(/,\s*(\d{2})\b/);
    if(m){
      const age = parseInt(m[1],10);
      if(age >= 18 && age <= 99) return age;
    }
  }
  const txts = [...document.querySelectorAll("div,span")]
    .slice(0, 200)
    .map(n => (n.textContent||"").trim())
    .filter(t => t.length <= 50);
  for(const t of txts){
    const m = t.match(/\b(\d{2})\b/);
    if(m && !/km|kilometer|away/i.test(t)){
      const age = parseInt(m[1],10);
      if(age >= 18 && age <= 99) return age;
    }
  }
  return null;
}

function getPictureCount(){
  const photoBtns = [...document.querySelectorAll("[aria-label*='photo' i],[aria-label*='picture' i]")];
  if(photoBtns.length){
    let max = 0;
    for(const el of photoBtns){
      const t = (el.getAttribute("aria-label")||"");
      const m = t.match(/of\s*(\d+)/i);
      if(m) max = Math.max(max, parseInt(m[1],10));
    }
    if(max > 0) return max;
  }

  const imgs = [...document.querySelectorAll("img")]
    .map(i => i.getAttribute("src")||"")
    .filter(src => src && !src.startsWith("data:"));
  const uniq = [...new Set(imgs)];
  const photoLike = uniq.filter(u =>
    /gotinder\.com|tinderphotos|images-ssl\.gotinder\.com|pbs\.twimg\.com|fbcdn/i.test(u)
  );
  if(photoLike.length) return Math.min(photoLike.length, 20);
  return null;
}

async function waitForProfilePanel(timeoutMs=9000){
  const start = Date.now();
  while(Date.now()-start < timeoutMs){
    if(!isRunning) return false;

    const aboutExists = [...document.querySelectorAll("h1,h2,h3,div[role='heading']")]
      .some(h => normalizeText(h.textContent) === "about me");
    const dist = getDistanceKm();

    if(aboutExists || dist !== null) return true;
    await sleep(250);
  }
  return false;
}

/* ---------- wait UI ---------- */

async function waitForCoreUI(timeoutMs=20000){
  const start = Date.now();
  while(Date.now()-start < timeoutMs){
    if(!isRunning) return false;

    if(isOverlayPresent()){
      await dismissOverlayOnce();
      await sleep(250);
      continue;
    }

    if(findByLabelOrText("like") || findByLabelOrText("open profile") || findByLabelOrText("info")){
      return true;
    }
    await sleep(300);
  }
  return false;
}

/* ---------- actions ---------- */

async function clickNope(){
  // Prefer keyboard to avoid swapped/moved buttons
  await pressNope();
  return true;
}

async function decideAndAct(){
  settings = await loadSettings();

  for(let i=0;i<6 && isOverlayPresent();i++){
    const did = await dismissOverlayOnce();
    if(!did) await sleep(400);
  }
  if(isOverlayPresent()) return "overlay-blocked";

  const openProfile = findByLabelOrText("open profile") || findByLabelOrText("info") || findByLabelOrText("details");
  if(!openProfile) return "open-profile-not-found";
  safeClick(openProfile);

  await sleep(1000); // required gap

  for(let i=0;i<4 && isOverlayPresent();i++){
    const did = await dismissOverlayOnce();
    if(!did) await sleep(300);
  }
  if(isOverlayPresent()) return "overlay-after-open";

  await waitForProfilePanel();

  const about = getAboutMeText();
  const dist = getDistanceKm();
  const age = getAge();
  const pics = getPictureCount();

  const reasons = [];

  if(settings.distEnabled && dist !== null && dist > settings.maxKm) reasons.push(`distance ${dist}>${settings.maxKm}`);
  if(settings.ageEnabled && age !== null && (age < settings.ageMin || age > settings.ageMax)) reasons.push(`age ${age} not ${settings.ageMin}-${settings.ageMax}`);
  if(settings.picsEnabled && pics !== null && pics < settings.minPics) reasons.push(`pics ${pics}<${settings.minPics}`);

  if(settings.kwEnabled){
    const text = normalizeText(about);
    const banned = (settings.bannedKeywords || []).map(x => String(x).toLowerCase()).filter(Boolean);
    const hit = banned.find(w => text.includes(w));
    if(hit) reasons.push(`keyword "${hit}"`);
  }

  if(reasons.length){
    clickNope();
    await sleep(1000);
    const aboutSnippet = compactAbout(about);
    await appendLog(aboutSnippet ? `NOPE (${reasons.join(", ")}) — ${aboutSnippet}` : `NOPE (${reasons.join(", ")})`);
    return `rejected(${reasons.join("+")})`;
  }

  // Prefer keyboard to avoid swapped/moved buttons
  await pressLike();
  await sleep(1000);
  // include About Me snippet in LIKE log (max 80 chars)
  const aboutSnippet = about ? about.replace(/\s+/g, " ").slice(0, 80) : "";
  await appendLog(aboutSnippet ? `LIKE — "${aboutSnippet}"` : "LIKE");
  return "liked";
}

/* ---------- loop ---------- */

async function runLoop(){
  await appendLog("Loop started");

  const ready = await waitForCoreUI();
  if(!ready){
    await appendLog("UI not ready (stopped or timeout)");
    return;
  }

  while(isRunning){
    try{
      const res = await decideAndAct();
      console.log("[Tinder Auto Like]", res);
    }catch(e){
      console.warn("[Tinder Auto Like] error", e);
      await appendLog(`Error: ${String(e?.message || e)}`);
      await sleep(1000);
    }
  }

  await appendLog("Loop stopped");
}

/* ---------- resume on load ---------- */

(async function resumeIfNeeded(){
  if(!location.href.startsWith("https://tinder.com/app/recs")) return;

  settings = await loadSettings();
  const st = await loadState();
  if(st.running){
    isRunning = true;
    runLoop();
  }
})();

/* ---------- messages from popup ---------- */

chrome.runtime.onMessage.addListener((msg, _s, sendResponse)=>{
  (async ()=>{
    if(!msg?.type) return;

    if(msg.type === "START"){
      isRunning = true;
      await saveState({ running: true, needRefresh: false });
      await appendLog("START received");
      runLoop();
      sendResponse({ ok:true, running:true });
      return;
    }

    if(msg.type === "STOP"){
      isRunning = false;
      await saveState({ running: false, needRefresh: false });
      await appendLog("STOP received");
      sendResponse({ ok:true, running:false });
      return;
    }

    if(msg.type === "STATUS"){
      const st = await loadState();
      sendResponse({ ok:true, running: !!st.running });
      return;
    }

    if(msg.type === "SETTINGS_UPDATED"){
      settings = await loadSettings();
      await appendLog("Settings updated");
      sendResponse({ ok:true });
      return;
    }
  })();
  return true;
});
