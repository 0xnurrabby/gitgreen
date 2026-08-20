// Background worker additions for ClipboardNotes.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
 if (msg.type === 'OPTIONS_CHANGED') {
 refreshBadge();
 }
 sendResponse({ ok: true });
});

async function refreshBadge() {
 const opts = await chrome.storage.sync.get({ badge: true, interval: 60 });
 if (!opts.badge) {
 chrome.action.setBadgeText({ text: '' });
 return;
 }
 const now = new Date();
 const text = String(now.getHours()).padStart(2, '0') + ':' + String(now.getMinutes()).padStart(2, '0');
 chrome.action.setBadgeText({ text });
 chrome.action.setBadgeBackgroundColor({ color: '#5b4dff' });
}

setInterval(refreshBadge, 15000);
refreshBadge();