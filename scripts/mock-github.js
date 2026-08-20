// Mock GitHub API for end-to-end testing. Run with:
//   node mock-github.js   (starts on :9999)
//   GITHUB_API_URL=http://localhost:9999 node server/index.js
const http = require('http');

const users = {
  mockuser: { login: 'mockuser', avatar_url: 'http://x/a.png', html_url: 'https://github.com/mockuser' }
};
const repos = {};

const server = http.createServer((req, res) => {
  const url = new URL(req.url, 'http://x');
  const auth = req.headers.authorization || '';
  if (!auth.startsWith('Bearer ') || auth.length < 12) {
    res.writeHead(401, { 'Content-Type': 'application/json' });
    return res.end(JSON.stringify({ message: 'Bad credentials' }));
  }
  let body = '';
  req.on('data', (c) => (body += c));
  req.on('end', () => {
    const send = (status, data) => {
      res.writeHead(status, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(data));
    };

    if (req.method === 'GET' && url.pathname === '/user') {
      return send(200, users.mockuser);
    }
    if (req.method === 'POST' && url.pathname === '/user/repos') {
      const b = JSON.parse(body || '{}');
      repos[b.name] = { full_name: `mockuser/${b.name}` };
      return send(201, { ...b, full_name: `mockuser/${b.name}`, html_url: `https://github.com/mockuser/${b.name}` });
    }
    const m = url.pathname.match(/^\/repos\/mockuser\/([^/]+)$/);
    if (m && req.method === 'GET') {
      return repos[m[1]] ? send(200, repos[m[1]]) : send(404, { message: 'Not Found' });
    }
    send(404, { message: 'No such route: ' + req.method + ' ' + url.pathname });
  });
});

server.listen(9999, () => console.log('mock github on :9999'));
