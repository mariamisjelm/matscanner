// Checks the same Search-a-licious request the search box sends.
// A browser only accepts the response when the preflight and the GET
// both allow https://mariamisjelm.github.io. Node does not enforce CORS,
// so this script checks those headers itself.
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
  ];
  if (method === 'GET') args.push('-L', '--max-redirs', '3');
  if (method === 'OPTIONS') {
    args.push(
      '-H', 'Access-Control-Request-Method: GET',
      '-H', 'Access-Control-Request-Headers: accept',
    );
  }
  args.push(url);
  const result = spawnSync('curl', args, { encoding: 'utf8' });
  if (result.error || result.status !== 0) {
    return { network: true, detail: (result.stderr || (result.error && result.error.message) || 'curl failed').trim() };
  }
  const rawHeaders = fs.readFileSync(headerFile, 'utf8');
  const blocks = rawHeaders.split(/\r?\n\r?\n/).filter(block => /^HTTP\//.test(block));
  const header = blocks.length ? blocks[blocks.length - 1] : rawHeaders;
  const body = fs.readFileSync(bodyFile, 'utf8');
  const status = Number((header.match(/^HTTP\/\S+\s+(\d+)/) || [])[1] || 0);
  return {
    status,
    allowOrigin: headerValue(header, 'access-control-allow-origin'),
    allowHeaders: headerValue(header, 'access-control-allow-headers'),
    body,
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

function corsOk(res) {
  return res.allowOrigin === ORIGIN || res.allowOrigin === '*';
}

function checkGet(label, url) {
  console.log(label, url);
  const preflight = curl('OPTIONS', url);
  const get = curl('GET', url);
  const count = get.body ? usableCount(get.body) : 0;
  console.log(JSON.stringify({
    label,
    preflightStatus: preflight.status || null,
    preflightOrigin: preflight.allowOrigin || null,
    preflightHeaders: preflight.allowHeaders || null,
    preflightNetwork: !!preflight.network,
    getStatus: get.status || null,
    getOrigin: get.allowOrigin || null,
    getNetwork: !!get.network,
    usable: count,
    detail: preflight.detail || get.detail || undefined,
  }));
  const preflightOk = !preflight.network && preflight.status >= 200 && preflight.status < 300
    && corsOk(preflight) && /accept/i.test(preflight.allowHeaders || '');
  const getOk = !get.network && get.status === 200 && corsOk(get) && count > 0;
  return preflightOk && getOk;
}

const text = 'coca cola';
const norwayOk = checkGet('norway', searchUrl(text));
const globalOk = norwayOk || checkGet('global', globalUrl(text));
if (!globalOk) {
  console.error('search request would fail in the browser');
  process.exit(1);
}
console.log('probe ok');
