// Builds the Privy auth widget into public/privy-auth.js
const esbuild = require('esbuild');
const path = require('path');

esbuild.buildSync({
  entryPoints: [path.join(__dirname, '..', 'auth', 'privy-auth.jsx')],
  bundle: true,
  outfile: path.join(__dirname, '..', 'public', 'privy-auth.js'),
  format: 'iife',
  jsx: 'automatic',
  loader: { '.js': 'jsx' },
  define: { 'process.env.NODE_ENV': '"production"' },
  minify: true,
  legalComments: 'none',
  logLevel: 'info'
});
console.log('built public/privy-auth.js');
