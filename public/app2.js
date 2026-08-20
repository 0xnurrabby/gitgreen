// Secondary interactivity for IconFinder.
document.addEventListener('DOMContentLoaded', () => {
 const forms = document.querySelectorAll('form[data-ajax]');
 forms.forEach((form) => {
 form.addEventListener('submit', async (e) => {
 e.preventDefault();
 const data = Object.fromEntries(new FormData(form));
 const res = await fetch(form.action || '/api/items', {
 method: 'POST',
 headers: { 'Content-Type': 'application/json' },
 body: JSON.stringify(data)
 });
 const result = await res.json();
 const msg = document.getElementById('form-result');
 if (msg) msg.textContent = res.ok ? 'Saved.' : result.error || 'Failed.';
 });
 });
});