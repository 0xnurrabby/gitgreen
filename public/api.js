// Client helpers for IconFinder.
async function apiGet(path) {
 const res = await fetch(path);
 if (!res.ok) throw new Error('request failed: ' + res.status);
 return res.json();
}

async function apiPost(path, body) {
 const res = await fetch(path, {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify(body)
 });
 if (!res.ok) throw new Error('request failed: ' + res.status);
 return res.json();
}

function fmtTime(ts) {
 return new Date(ts).toLocaleString();
}

function fmtNumber(n) {
 return new Intl.NumberFormat().format(n);
}

window.api = { get: apiGet, post: apiPost, time: fmtTime, number: fmtNumber };