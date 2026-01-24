# Tinder Auto Like – Chrome Extension

A simple Chrome extension that automates the following flow on Tinder Web:

**Open Profile → wait 1 second → Like → repeat**

The logic runs in an infinite loop and can be safely stopped at any time via the extension popup.

---

## ⚠️ Disclaimer

This project is for **educational and experimental purposes only**.

- Tinder may prohibit automated interactions in their Terms of Service.
- Using this extension may result in account restrictions or bans.
- You use this software **entirely at your own risk**.

---

## ✨ Features

- Works **only** on `https://tinder.com/app/recs`
- Manual login (no credential handling)
- Start / Stop control via popup
- Infinite loop until manually stopped
- Mandatory **1 second delay** between:
  - Open Profile → Like
  - Each iteration
- No background activity on other tabs or pages

---

## 🧠 How It Works (High Level)

- User logs into Tinder manually
- Content script listens only on `/app/recs`
- Popup sends `START` / `STOP` messages to the content script
- Content script:
  1. Clicks **Open Profile**
  2. Waits **1000 ms**
  3. Clicks **Like**
  4. Waits **1000 ms**
  5. Repeats until stopped

Button detection is **best-effort** using:
- `aria-label`
- visible button text

(No hard-coded class names)

---

## 🧩 Installation

1. Clone or download this repository
2. Open chrome://extensions/
3. Click on Load unpack
4. Select tinder_auto_like_extension folder 

## ▶️ Usage

1. Go to `https://tinder.com`
2. Log in manually
3. Press **Start**
6. Press **Stop** anytime to halt the loop

Status is shown directly in the popup.

---

## 🛠 Project Structure

```text
tinder_auto_like_extension/
├── manifest.json
├── content.js       # Core automation logic
├── popup.html       # UI
├── popup.js         # Start / Stop messaging
├── icon16.png
├── icon32.png
└── icon48.png

