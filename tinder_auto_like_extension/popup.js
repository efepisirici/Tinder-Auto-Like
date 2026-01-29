// popup.js - settings UI + Start/Stop + Trace
const DEFAULTS = {
  ageEnabled: true,
  ageMin: 20,
  ageMax: 35,
  distEnabled: true,
  maxKm: 100,
  picsEnabled: false,
  minPics: 2,
  kwEnabled: true,
  bannedKeywords: ["gay", "trans",  "model", "onlyfans"]
};

const LOG_KEY = "tal_log";
const MAX_LOG = 60;

function $(id){ return document.getElementById(id); }

function setStatus(text){ $("status").textContent = text || "—"; }

function fmtTime(ts){
  try{
    const d = new Date(ts);
    const hh = String(d.getHours()).padStart(2,"0");
    const mm = String(d.getMinutes()).padStart(2,"0");
    const ss = String(d.getSeconds()).padStart(2,"0");
    return `${hh}:${mm}:${ss}`;
  }catch{ return ""; }
}

async function appendLog(message){
  const ts = Date.now();
  const { [LOG_KEY]: cur } = await chrome.storage.local.get(LOG_KEY);
  const arr = Array.isArray(cur) ? cur : [];
  arr.push({ ts, message });
  const trimmed = arr.slice(-MAX_LOG);
  await chrome.storage.local.set({ [LOG_KEY]: trimmed });
}

async function loadLog(){
  const { [LOG_KEY]: cur } = await chrome.storage.local.get(LOG_KEY);
  return Array.isArray(cur) ? cur : [];
}

function renderLog(items){
  const box = $("logList");
  if(!box) return;
  box.innerHTML = "";
  const recent = (items || []).slice().reverse().slice(0, 30); // show last 30 (latest first)

  if(!recent.length){
    const empty = document.createElement("div");
    empty.style.opacity = "0.7";
    empty.textContent = "No activity yet.";
    box.appendChild(empty);
    return;
  }

  for(const it of recent){
    const row = document.createElement("div");
    row.className = "log-item";
    const t = document.createElement("div");
    t.className = "log-time";
    t.textContent = fmtTime(it.ts);
    const m = document.createElement("div");
    m.className = "log-msg";
    m.textContent = it.message;
    row.appendChild(t);
    row.appendChild(m);
    box.appendChild(row);
  }
}

async function getActiveTab(){
  const tabs = await chrome.tabs.query({active:true, currentWindow:true});
  const tab = tabs?.[0];
  if(!tab?.id) throw new Error("No active tab");
  return tab;
}

async function sendToActiveTab(message){
  const tab = await getActiveTab();
  const url = tab.url || "";
  if(!url.startsWith("https://tinder.com/app/recs")) throw new Error("NOT_RECS");
  return new Promise((resolve, reject)=>{
    chrome.tabs.sendMessage(tab.id, message, (resp)=>{
      const err = chrome.runtime.lastError;
      if(err) return reject(new Error(err.message));
      resolve(resp);
    });
  });
}

async function loadSettings(){
  const { tal_settings } = await chrome.storage.local.get("tal_settings");
  const s = Object.assign({}, DEFAULTS, tal_settings || {});
  s.ageMin = Math.max(18, Math.min(75, Number(s.ageMin)||25));
  s.ageMax = Math.max(18, Math.min(75, Number(s.ageMax)||35));
  if(s.ageMin > s.ageMax) [s.ageMin, s.ageMax] = [s.ageMax, s.ageMin];
  s.maxKm = Math.max(1, Math.min(150, Number(s.maxKm)||50));
  s.minPics = Math.max(1, Math.min(10, Number(s.minPics)||2));
  s.bannedKeywords = Array.isArray(s.bannedKeywords) ? s.bannedKeywords : [];
  return s;
}

async function saveSettings(s){
  await chrome.storage.local.set({ tal_settings: s });
  try{ await sendToActiveTab({ type: "SETTINGS_UPDATED" }); }catch{}
}

function renderChips(keywords){
  const chips = $("chips");
  chips.innerHTML = "";
  keywords.forEach((kw, idx)=>{
    const el = document.createElement("div");
    el.className = "chip";
    el.textContent = kw;
    const b = document.createElement("button");
    b.textContent = "×";
    b.title = "Remove";
    b.addEventListener("click", async ()=>{
      const s = await loadSettings();
      s.bannedKeywords.splice(idx, 1);
      await saveSettings(s);
      applyToUI(s);
      await appendLog(`Keyword removed: ${kw}`);
    });
    el.appendChild(b);
    chips.appendChild(el);
  });
}

function applyToUI(s){
  $("ageEnabled").checked = !!s.ageEnabled;
  $("ageMin").value = s.ageMin;
  $("ageMax").value = s.ageMax;
  $("ageMinVal").textContent = String(s.ageMin);
  $("ageMaxVal").textContent = String(s.ageMax);

  $("distEnabled").checked = !!s.distEnabled;
  $("maxKm").value = s.maxKm;
  $("maxKmVal").textContent = String(s.maxKm);

  $("picsEnabled").checked = !!s.picsEnabled;
  $("minPics").value = s.minPics;
  $("minPicsVal").textContent = String(s.minPics);

  $("kwEnabled").checked = !!s.kwEnabled;
  renderChips(s.bannedKeywords || []);
}

async function refreshStatus(){
  try{
    const res = await sendToActiveTab({ type: "STATUS" });
    if(res?.ok) setStatus(res.running ? "Running…" : "Stopped");
    else setStatus("Open tinder.com/app/recs");
  }catch{
    setStatus("Open tinder.com/app/recs");
  }
}

async function pollUntilReady(timeoutMs=9000, intervalMs=500){
  const start = Date.now();
  while(Date.now()-start < timeoutMs){
    try{
      const res = await sendToActiveTab({ type: "STATUS" });
      if(res?.ok){
        setStatus(res.running ? "Running…" : "Stopped");
        return;
      }
    }catch{}
    await new Promise(r=>setTimeout(r, intervalMs));
  }
  setStatus("Open tinder.com/app/recs");
}

document.addEventListener("DOMContentLoaded", async ()=>{
  const s = await loadSettings();
  applyToUI(s);
  await refreshStatus();

  // load + render log
  renderLog(await loadLog());

  // live updates
  chrome.storage.onChanged.addListener((changes, areaName)=>{
    if(areaName !== "local") return;
    if(changes[LOG_KEY]){
      renderLog(changes[LOG_KEY].newValue || []);
    }
  });

  $("clearLogBtn")?.addEventListener("click", async ()=>{
    await chrome.storage.local.set({ [LOG_KEY]: [] });
    renderLog([]);
  });

  const onAnyChange = async ()=>{
    const cur = await loadSettings();
    cur.ageEnabled = $("ageEnabled").checked;
    cur.ageMin = Number($("ageMin").value);
    cur.ageMax = Number($("ageMax").value);
    if(cur.ageMin > cur.ageMax) cur.ageMin = cur.ageMax;
    cur.distEnabled = $("distEnabled").checked;
    cur.maxKm = Number($("maxKm").value);
    cur.picsEnabled = $("picsEnabled").checked;
    cur.minPics = Number($("minPics").value);
    cur.kwEnabled = $("kwEnabled").checked;
    await saveSettings(cur);
    applyToUI(cur);
  };

  ["ageEnabled","ageMin","ageMax","distEnabled","maxKm","picsEnabled","minPics","kwEnabled"]
    .forEach(id => $(id).addEventListener("input", onAnyChange));

  $("kwAddBtn").addEventListener("click", async ()=>{
    const val = ($("kwInput").value || "").trim();
    if(!val) return;
    const cur = await loadSettings();
    const lower = val.toLowerCase();
    if(!cur.bannedKeywords.map(x=>String(x).toLowerCase()).includes(lower)){
      cur.bannedKeywords.push(val);
      await saveSettings(cur);
      applyToUI(cur);
      await appendLog(`Keyword added: ${val}`);
    }
    $("kwInput").value = "";
  });

  $("kwInput").addEventListener("keydown", (e)=>{
    if(e.key === "Enter"){ e.preventDefault(); $("kwAddBtn").click(); }
  });

  $("startBtn").addEventListener("click", async ()=>{
    try{
      setStatus("Starting…");
      await appendLog("Start clicked");
      await sendToActiveTab({ type: "START" });
      await pollUntilReady();
    }catch{
      setStatus("Open tinder.com/app/recs");
    }
  });

  $("stopBtn").addEventListener("click", async ()=>{
    try{
      await appendLog("Stop clicked");
      await sendToActiveTab({ type: "STOP" });
    }finally{
      setStatus("Stopped");
    }
  });
});
