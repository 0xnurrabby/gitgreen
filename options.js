const interval = document.getElementById('interval');
const badge = document.getElementById('badge');
const status = document.getElementById('status');

function load() {
 chrome.storage.sync.get({ interval: 60, badge: true }, (opts) => {
 interval.value = opts.interval;
 badge.checked = opts.badge;
 });
}

function save() {
 chrome.storage.sync.set({
 interval: Math.max(1, Number(interval.value) || 60),
 badge: badge.checked
 }, () => {
 status.textContent = 'Saved at ' + new Date().toLocaleTimeString();
 chrome.runtime.sendMessage({ type: 'OPTIONS_CHANGED' });
 });
}

load();
document.getElementById('save').addEventListener('click', save);