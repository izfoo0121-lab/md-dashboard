const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'sales_dashboard.html'), 'utf8');
const cp = (...codes) => String.fromCodePoint(...codes);

const mojibakeMarkers = [
  cp(0x00f0, 0x0178), // emoji decoded as Windows-1252
  cp(0x00e5, 0x00a5, 0x2021, 0x00e8, 0x00bf, 0x00b9), // 奇迹 decoded as Windows-1252
  cp(0x00e2, 0x20ac, 0x201d), // em dash decoded as Windows-1252
  cp(0x00e2, 0x20ac, 0x00a2), // bullet decoded as Windows-1252
  cp(0x00c2, 0x00a0) // non-breaking space decoded as Windows-1252
];

for (const marker of mojibakeMarkers) {
  assert(
    !html.includes(marker),
    `sales_dashboard.html contains mojibake marker: ${JSON.stringify(marker)}`
  );
}

assert(html.includes(`Miracle-${cp(0x5947, 0x8ff9)} MD`), 'Chinese dashboard title should be readable');
assert(html.includes(cp(0x1f3af)), 'Emoji labels should be readable');
assert(html.includes(cp(0x2014)), 'Dash punctuation should be readable');

console.log('sales_encoding.test.cjs passed');
