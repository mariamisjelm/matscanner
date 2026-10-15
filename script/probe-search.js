// Checks the same Search-a-licious request the search box sends.
// The page fetches with GET and Accept: application/json. That header is
// CORS-safelisted, so the browser does not send a preflight. It still
// requires Access-Control-Allow-Origin on the response.
const fs = require('fs');
const os = require('os');
const path = require('path');
const vm = require('vm');
const { spawnSync } = require('child_process');

const ORIGIN = 'https://mariamisjelm.github.io';
const html = fs.readFileSync(path.join(__dirname, '../index.html'), 'utf8');
const start = html.indexOf('// TEST_EXPORT_START');
const end = html.indexOf('// TEST_EXPORT_END');
if (start === -1 || end < start) {
  console.error('search helpers are not marked for export');
  process.exit(1);
}
const consts = ['OFF_FULLTEXT', 'SEARCH_LANGS', 'SEARCH_LIST_FIELDS', 'ALT_FIELDS']
  .map(name => {
    const m = html.match(new RegExp(`const ${name} = ([^;]+);`));
    if (!m) throw new Error('missing ' + name);
    return `var ${name} = ${m[1]};`;
  })
  .join('\n');
const sandbox = { URLSearchParams };
vm.createContext(sandbox);
vm.runInContext(`${consts}\n${html.slice(start, end)}`, sandbox);

function searchUrl(text) {
  return sandbox.fulltextSearchUrl(sandbox.norwayQuery(sandbox.searchTerms(text)));
}

function globalUrl(text) {
  return sandbox.fulltextSearchUrl(sandbox.searchTerms(text));
}

function headerValue(headerText, name) {
  const line = headerText.split(/\r?\n/).find(l => l.toLowerCase().startsWith(name.toLowerCase() + ':'));
  return line ? line.slice(line.indexOf(':') + 1).trim() : '';
}

function curl(method, url) {
  const headerFile = path.join(os.tmpdir(), `matskanner-probe-${method}-${process.pid}.hdr`);
  const bodyFile = path.join(os.tmpdir(), `matskanner-probe-${method}-${process.pid}.body`);
  const args = [
    '-sS', '--max-time', '40',
    '-D', headerFile, '-o', bodyFile,
    '-X', method,
    '-H', 'Origin: ' + ORIGIN,
    '-H', 'Accept: application/json',
    url,
  ];
  const result = spawnSync('curl', args, { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    return {
      network: true,
      status: 0,
      allowOrigin: '',
      usable: 0,
      detail: (result.stderr || (result.error && result.error.message) || 'curl failed').trim(),
    };
  }
  const rawHeaders = fs.readFileSync(headerFile, 'utf8');
  const blocks = rawHeaders.split(/\r?\n\r?\n/).filter(block => /^HTTP\//.test(block));
  const header = blocks.length ? blocks[blocks.length - 1] : rawHeaders;
  const body = fs.readFileSync(bodyFile, 'utf8');
  const status = Number((header.match(/^HTTP\/\S+\s+(\d+)/) || [])[1] || 0);
  return {
    network: false,
    status,
    allowOrigin: headerValue(header, 'access-control-allow-origin'),
    usable: usableCount(body),
    detail: '',
  };
}

function usableCount(body) {
  let data;
  try {
    data = JSON.parse(body);
  } catch (_) {
    return 0;
  }
  const hits = data && Array.isArray(data.hits) ? data.hits : [];
  return hits.filter(p => p && p.code && (
    p.product_name_no || p.product_name_nb || p.product_name_nn || p.product_name || p.product_name_en
  )).length;
}

function browserWouldShowResults(res) {
  if (!res || res.network || res.status !== 200) return false;
  if (res.allowOrigin !== ORIGIN && res.allowOrigin !== '*') return false;
  return res.usable > 0;
}

function checkGet(label, url) {
  console.log(label, url);
  const res = curl('GET', url);
  console.log(JSON.stringify({ label, ...res }));
  return res;
}

function main() {
  const text = 'coca cola';
  const norway = checkGet('norway', searchUrl(text));
  if (browserWouldShowResults(norway) || browserWouldShowResults(checkGet('global', globalUrl(text)))) {
    console.log('probe ok');
    return;
  }
  console.error('search request would fail in the browser');
  process.exit(1);
}

if (require.main === module) main();

module.exports = { browserWouldShowResults, ORIGIN };
