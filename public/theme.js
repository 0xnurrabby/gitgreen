// Minimal theme helper for IconFinder.
(function () {
 const saved = localStorage.getItem('theme');
 if (saved === 'dark') document.documentElement.classList.add('dark');

 const toggle = document.createElement('button');
 toggle.textContent = saved === 'dark' ? 'Light' : 'Dark';
 toggle.className = 'theme-toggle';
 toggle.addEventListener('click', () => {
 const isDark = document.documentElement.classList.toggle('dark');
 localStorage.setItem('theme', isDark ? 'dark' : 'light');
 toggle.textContent = isDark ? 'Light' : 'Dark';
 });
 document.addEventListener('DOMContentLoaded', () => {
 const nav = document.querySelector('.nav-inner');
 if (nav) nav.appendChild(toggle);
 });
})();