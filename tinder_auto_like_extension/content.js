// content.js - runs in the context of Tinder's recommendations page.
//
// This script only listens and operates on https://tinder.com/app/recs* (per manifest matches).
// It stays idle until the user clicks "Start" in the extension popup.

let isRunning = false;

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Try to locate a button element on the page using a variety of strategies.
 * Best-effort: Tinder UI can change.
 */
function findButtonByLabel(labelText) {
  const normalized = String(labelText).trim().toLowerCase();

  // 1) aria-label exact match (case-insensitive)
  const ariaMatch = Array.from(document.querySelectorAll('button[aria-label]'))
    .find((btn) => (btn.getAttribute('aria-label') || '').trim().toLowerCase() === normalized);
  if (ariaMatch) return ariaMatch;

  // 2) aria-label contains
  const ariaContains = Array.from(document.querySelectorAll('button[aria-label]'))
    .find((btn) => (btn.getAttribute('aria-label') || '').trim().toLowerCase().includes(normalized));
  if (ariaContains) return ariaContains;

  // 3) Visible text content exact (fallback)
  const textMatch = Array.from(document.querySelectorAll('button, div[role="button"]'))
    .find((el) => (el.textContent || '').trim().toLowerCase() === normalized);
  if (textMatch) return textMatch;

  // 4) Visible text content contains (fallback)
  const textContains = Array.from(document.querySelectorAll('button, div[role="button"]'))
    .find((el) => (el.textContent || '').trim().toLowerCase().includes(normalized));
  if (textContains) return textContains;

  return null;
}

function safeClick(el) {
  if (!el) return false;
  try {
    const btn = el.closest('button,[role="button"]') || el;
    btn.scrollIntoView({ behavior: 'instant', block: 'center', inline: 'center' });
    btn.click();
    return true;
  } catch (e) {
    console.warn('[Tinder Auto Like] Click failed:', e);
    return false;
  }
}

/**
 * Performs: Open Profile -> wait 1s -> Like -> wait 1s
 * Returns a status string describing what happened.
 */
async function openAndLikeOnce() {
  if (!location.href.startsWith('https://tinder.com/app/recs')) {
    return 'Not on /app/recs';
  }

  const openProfileBtn =
    findButtonByLabel('Open Profile') ||
    findButtonByLabel('Open profile') ||
    findButtonByLabel('Info') ||
    findButtonByLabel('Details');

  if (!openProfileBtn) return 'Open Profile button not found';
  safeClick(openProfileBtn);

  // Required delay between "Open Profile" and "Like"
  await sleep(1000);

  const likeBtn =
    findButtonByLabel('Like') ||
    findButtonByLabel('Like it') ||
    findButtonByLabel('LIKE');

  if (!likeBtn) return 'Like button not found';
  safeClick(likeBtn);

  // Gap before next iteration
  await sleep(1000);

  return 'OK';
}

async function runLoop() {
  console.log('[Tinder Auto Like] Loop started');
  while (isRunning) {
    try {
      const res = await openAndLikeOnce();
      console.log('[Tinder Auto Like] Iteration result:', res);
    } catch (e) {
      console.warn('[Tinder Auto Like] Iteration error:', e);
      await sleep(1000);
    }
  }
  console.log('[Tinder Auto Like] Loop stopped');
}

chrome.runtime.onMessage.addListener((message, _sender, sendResponse) => {
  try {
    if (!message || typeof message !== 'object') return;

    if (message.type === 'START') {
      if (!isRunning) {
        isRunning = true;
        runLoop(); // fire-and-forget loop
      }
      sendResponse({ ok: true, running: true });
      return;
    }

    if (message.type === 'STOP') {
      isRunning = false;
      sendResponse({ ok: true, running: false });
      return;
    }

    if (message.type === 'STATUS') {
      sendResponse({ ok: true, running: isRunning });
      return;
    }
  } catch (e) {
    console.warn('[Tinder Auto Like] Message handler error:', e);
    sendResponse({ ok: false, error: String(e) });
  }
});
