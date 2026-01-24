// popup.js - handles interactions in the extension popup.

async function withActiveTab(fn) {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error('No active tab found');
  return fn(tab.id);
}

function setStatus(text) {
  const el = document.getElementById('status');
  el.textContent = text || '';
}

async function sendToActiveTab(message) {
  return withActiveTab((tabId) => chrome.tabs.sendMessage(tabId, message));
}

async function refreshStatus() {
  try {
    const res = await sendToActiveTab({ type: 'STATUS' });
    if (res?.ok) setStatus(res.running ? 'Running…' : 'Stopped');
    else setStatus('Open tinder.com/app/recs');
  } catch {
    setStatus('Open tinder.com/app/recs');
  }
}

document.addEventListener('DOMContentLoaded', async () => {
  const startBtn = document.getElementById('startBtn');
  const stopBtn = document.getElementById('stopBtn');

  startBtn.addEventListener('click', async () => {
    try {
      const res = await sendToActiveTab({ type: 'START' });
      setStatus(res?.ok ? 'Running…' : 'Open tinder.com/app/recs');
    } catch {
      setStatus('Open tinder.com/app/recs');
    }
  });

  stopBtn.addEventListener('click', async () => {
    try {
      await sendToActiveTab({ type: 'STOP' });
    } finally {
      setStatus('Stopped');
    }
  });

  await refreshStatus();
});
