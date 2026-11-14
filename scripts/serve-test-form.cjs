// A harmless local form for the owner's browser acceptance (docs/OWNER-STEPS.md section 6): one text field and one button.
// Serves only http://127.0.0.1:4173/, nothing else, and keeps nothing: the typed name is shown on the page and never stored.
// Usage: node scripts/serve-test-form.cjs   (Ctrl+C to stop)
const http = require('node:http')

const page = `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>NAJD harmless test form</title></head>
<body style="font:16px system-ui;margin:2rem">
<h1>NAJD test form</h1>
<label>Name <input id="name" name="name" autocomplete="off"></label>
<button id="go" type="button">Greet</button>
<p id="result">Nobody greeted yet</p>
<script>document.getElementById('go').addEventListener('click', () => { document.getElementById('result').textContent = 'Hello, ' + document.getElementById('name').value })</script>
</body></html>`

const server = http.createServer((request, response) => {
  if (request.method !== 'GET' || request.url !== '/') { response.writeHead(404).end(); return }
  response.writeHead(200, { 'content-type': 'text/html; charset=utf-8', 'cache-control': 'no-store' }).end(page)
})
server.listen(4173, '127.0.0.1', () => console.log('NAJD test form: http://127.0.0.1:4173/ (Ctrl+C to stop)'))
