const assert = require('assert');
const fs = require('fs');
const path = require('path');

const html = fs.readFileSync(path.join(__dirname, '..', 'management.html'), 'utf8');
const match = html.match(
  /(async function fetch_birthday_claims[\s\S]*?\n  })\n  function applyBirthdayOverride/
);

assert(match, 'fetch_birthday_claims should be present in management.html');

const fakeConsole = { warn() {}, log() {} };
const fetchBirthdayClaims = new Function(
  'SUPABASE_URL',
  'SUPABASE_KEY',
  'fetch',
  'console',
  `return (${match[1]});`
);

(async () => {
  const calls = [];
  const fakeFetch = async url => {
    calls.push(url);
    if (calls.length === 1) {
      return { ok: false, status: 400, json: async () => ({}) };
    }
    return {
      ok: true,
      status: 200,
      json: async () => [
        { agent: 'CJ', status: 'verified', debtor_code: '300-C001' },
        { agent: 'CJ', status: 'excluded', debtor_code: '300-C002' },
      ],
    };
  };

  const fn = fetchBirthdayClaims(
    'https://example.supabase.co',
    'anon-key',
    fakeFetch,
    fakeConsole
  );
  const result = await fn('Jul 26', [
    { code: '300-C001' },
    { code: '300-C002' },
  ]);

  assert.strictEqual(calls.length, 2, 'A missing stage column should retry the legacy claims query');
  assert(!calls[1].includes('stage'), 'Legacy retry should not select or filter the stage column');
  assert.deepStrictEqual(result, { CJ: { verified: 1, excluded: 1 } });

  console.log('management_birthday_claims_legacy.test.cjs passed');
})().catch(error => {
  console.error(error);
  process.exitCode = 1;
});
