const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

const html = fs.readFileSync(require('node:path').join(__dirname, '../index.html'), 'utf8');
const start = html.indexOf('// TEST_EXPORT_START');
const end = html.indexOf('// TEST_EXPORT_END');
assert.ok(start !== -1 && end > start, 'search helpers are marked for export');

const consts = ['OFF_FULLTEXT', 'SEARCH_LANGS', 'SEARCH_LIST_FIELDS', 'ALT_FIELDS']
  .map(name => {
    const m = html.match(new RegExp(`const ${name} = ([^;]+);`));
    assert.ok(m, name);
    return `var ${name} = ${m[1]};`;
  })
  .join('\n');

const sandbox = { URLSearchParams };
vm.createContext(sandbox);
vm.runInContext(`${consts}\n${html.slice(start, end)}`, sandbox);

test('name search uses Search-a-licious and prefers products sold in Norway', () => {
  const url = new URL(sandbox.fulltextSearchUrl(sandbox.norwayQuery(sandbox.searchTerms('coca cola'))));
  assert.equal(url.origin + url.pathname, 'https://search.openfoodfacts.org/search');
  assert.equal(url.searchParams.get('q'), 'coca cola countries:"en:norway"');
  assert.match(url.searchParams.get('langs'), /^no,/);
  assert.match(url.searchParams.get('fields'), /product_name_no/);
  assert.equal(html.includes('search.pl?'), false);
  assert.equal(/OFF_SEARCH|OFF_TEXT_SEARCH/.test(html), false);
});

test('search text cannot inject extra lucene filters', () => {
  assert.equal(sandbox.searchTerms('cola (zero) countries:en:france'), 'cola zero countries en france');
});

test('taxonomy brand tags become readable names', () => {
  const product = sandbox.searchHitProduct({ code: '1', brands: ['en:coca-cola', 'xx:coca-cola'] });
  assert.equal(product.brands, 'coca cola, coca cola');
  assert.equal(sandbox.brandText('Coca-Cola'), 'Coca-Cola');
});

test('category search stays on the same service and asks for nutrition fields', () => {
  const url = new URL(sandbox.fulltextSearchUrl(
    `categories:${sandbox.quoteTag('en:sodas')} countries:${sandbox.quoteTag('en:norway')}`,
    { pageSize: 40, fields: sandbox.ALT_FIELDS }
  ));
  assert.equal(url.origin + url.pathname, 'https://search.openfoodfacts.org/search');
  assert.equal(url.searchParams.get('q'), 'categories:"en:sodas" countries:"en:norway"');
  assert.equal(url.searchParams.get('page_size'), '40');
  assert.match(url.searchParams.get('fields'), /nutriments/);
});
