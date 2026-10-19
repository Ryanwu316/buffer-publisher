import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { doctor, normalizePostInput, run, loadToken } from '../scripts/buffer_publish.mjs';

const now = Date.parse('2026-10-19T00:00:00Z');
const mockKey = 'mock-private-key';
const environment = { BUFFER_API_KEY: mockKey };
const noFile = async () => { throw Object.assign(new Error('Not found'), { code: 'ENOENT' }); };
const payload = { channelIds: ['demo'], text: 'First line\nSecond line', assets: [] };
const post = id => ({ id, channelId: 'demo', text: payload.text, status: 'draft', assets: [], dueAt: null });

test('conflicting JSON and CLI values never silently remove requested media or change destinations', () => {
  for (const options of [{ imageUrl: 'https://example.com/a.png' }, { videoUrl: 'https://example.com/a.mp4' },
    { channelId: 'another-channel' }, { text: 'Another post' }]) {
    assert.throws(() => normalizePostInput('draft', options, payload, now), /Conflicting input/);
  }
  assert.throws(() => normalizePostInput('schedule', { dueAt: '2099-01-02T00:00:00Z' },
    { ...payload, dueAt: '2099-01-01T00:00:00Z' }, now), /Conflicting input/);
});

test('CLI can supply a field that is absent from JSON', async () => {
  const result = await run(['draft', '--json-file', 'demo.json', '--image-url', 'https://example.com/a.png', '--dry-run'], {
    now, read: async () => JSON.stringify({ channelIds: ['demo'], text: payload.text }),
    graphql: () => { throw new Error('Must not connect'); },
  });
  assert.equal(result.inputs[0].assets[0].image.url, 'https://example.com/a.png');
});

test('a conflicting image option fails before any API request', async () => {
  let calls = 0;
  await assert.rejects(run(['draft', '--json-file', 'demo.json', '--image-url', 'https://example.com/a.png'], {
    now, read: async () => JSON.stringify(payload), graphql: async () => { calls++; },
  }), /Conflicting input/);
  assert.equal(calls, 0);
});

test('explicit null fields are invalid instead of silently falling back', () => {
  for (const field of ['channelIds', 'text', 'assets', 'dueAt']) {
    assert.throws(() => normalizePostInput('draft', {}, { ...payload, [field]: null }, now), /cannot be null/);
  }
});

test('offline doctor checks setup without making requests or exposing key material', async () => {
  const result = await doctor({ environment, nodeVersion: '20.19.0',
    graphql: () => { throw new Error('Must not connect'); } });
  assert.equal(result.ok, true);
  assert.equal(result.online, false);
  assert.deepEqual(result.checks.map(check => check.name), ['runtime', 'credentials']);
  assert.ok(!JSON.stringify(result).includes(mockKey));
});

test('online doctor issues only discovery queries and exposes counts instead of account details', async () => {
  const queries = [];
  const result = await run(['doctor', '--online'], { environment, nodeVersion: '22.0.0',
    graphql: async query => {
      queries.push(query);
      return query.includes('GetOrganizations') ? { account: { organizations: [{ id: 'private-org-id', name: 'Private company' }] } }
        : { channels: [{ id: 'private-channel-id', name: 'Private channel', service: 'linkedin' }] };
    } });
  assert.equal(result.ok, true);
  assert.equal(result.checks[2].organizationCount, 1);
  assert.equal(result.checks[2].channelCount, 1);
  assert.equal(queries.length, 2);
  assert.ok(queries.every(query => query.startsWith('query')));
  assert.ok(!/private-|Private |mock-private-key/.test(JSON.stringify(result)));
});

test('doctor reports missing configuration and skips online access until fixed', async () => {
  let calls = 0;
  const result = await doctor({ online: true, environment: {}, read: noFile,
    graphql: () => { calls++; } });
  assert.equal(result.ok, false);
  assert.equal(result.checks[1].ok, false);
  assert.equal(result.checks[2].skipped, true);
  assert.equal(calls, 0);
});

test('doctor rejects an unsupported runtime before connecting', async () => {
  let calls = 0;
  const result = await doctor({ online: true, environment, nodeVersion: '18.20.0', graphql: () => { calls++; } });
  assert.equal(result.ok, false);
  assert.equal(result.checks[0].ok, false);
  assert.equal(result.checks[2].skipped, true);
  assert.equal(calls, 0);
});

test('doctor distinguishes configured credentials from a failed live check without leaking diagnostics', async () => {
  const result = await doctor({ online: true, environment,
    graphql: async () => { throw new Error(`Rejected ${mockKey}`); } });
  assert.equal(result.ok, false);
  assert.equal(result.checks[1].ok, true);
  assert.equal(result.checks[2].ok, false);
  assert.ok(!JSON.stringify(result).includes(mockKey));
});

test('empty and example keys are diagnosed locally; BOM and quoted Windows key files work', async () => {
  for (const value of ['""', 'REPLACE_WITH_YOUR_PRIVATE_KEY']) {
    await assert.rejects(loadToken({ BUFFER_API_KEY_FILE: 'demo' }, async () => `BUFFER_API_KEY=${value}\n`), /own non-empty/);
  }
  assert.equal(await loadToken({ BUFFER_API_KEY_FILE: 'demo' }, async () => `\uFEFFBUFFER_API_KEY="${mockKey}"\r\n`), mockKey);
});

test('UTF-8 BOM JSON files work in offline preview', async () => {
  const result = await run(['draft', '--json-file', 'windows.json', '--dry-run'], {
    read: async () => '\uFEFF' + JSON.stringify(payload), now,
  });
  assert.equal(result.ok, true);
  assert.equal(result.inputs[0].text, payload.text);
});

test('batch recovery reads retain successful results around a missing post', async () => {
  const result = await run(['get', '--post-ids', 'first,missing,third'], {
    graphql: async (_, { id }) => {
      if (id === 'missing') throw new Error('Post not found');
      return { post: post(id) };
    },
  });
  assert.equal(result.ok, false);
  assert.deepEqual(result.posts.map(p => [p.id, p.ok]), [['first', true], ['missing', false], ['third', true]]);
});

test('verification compares exact multiline copy from a UTF-8 file and preserves whitespace', async () => {
  const dependencies = { graphql: async (_, { id }) => ({ post: post(id) }), read: async () => '\uFEFF' + payload.text };
  const matching = await run(['verify', '--post-id', 'known', '--expected-text-file', 'approved.txt'], dependencies);
  assert.equal(matching.ok, true);
  const changed = await run(['verify', '--post-id', 'known', '--expected-text-file', 'approved.txt'], {
    ...dependencies, read: async () => payload.text + '\n',
  });
  assert.equal(changed.ok, false);
  assert.deepEqual(changed.posts[0].issues, ['Post text does not match.']);
});

test('unreadable expected copy fails before any API access', async () => {
  let calls = 0;
  await assert.rejects(run(['verify', '--post-id', 'known', '--expected-text-file', 'missing.txt'], {
    read: noFile, graphql: async () => { calls++; },
  }), /expected-text-file/);
  assert.equal(calls, 0);
});

test('doctor is a usable CLI command and returns nonzero for missing credentials', () => {
  const cli = fileURLToPath(new URL('../scripts/buffer_publish.mjs', import.meta.url));
  const valid = spawnSync(process.execPath, [cli, 'doctor'], { encoding: 'utf8', env: { ...process.env, BUFFER_API_KEY: mockKey } });
  assert.equal(valid.status, 0);
  assert.equal(JSON.parse(valid.stdout).online, false);
  assert.ok(!valid.stdout.includes(mockKey));
  const missing = spawnSync(process.execPath, [cli, 'doctor'], { encoding: 'utf8',
    env: { ...process.env, BUFFER_API_KEY: '', BUFFER_API_KEY_FILE: '/nonexistent/buffer-publisher-key' } });
  assert.equal(missing.status, 1);
  assert.equal(JSON.parse(missing.stdout).ok, false);
});
