import test from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { parseArgs, normalizePostInput, createPostInput, createClient, createPosts, run,
  timestamp, verificationIssues, loadToken } from '../scripts/buffer_publish.mjs';

const now = Date.parse('2026-10-16T00:00:00Z');
const base = { channelIds: ['channel-a'], text: 'A real post\nwith two lines.', assets: [] };
const saved = { id: 'post-a', channelId: 'channel-a', text: base.text, status: 'draft', dueAt: null, assets: [] };

test('offline preview works without key, credentials, or any API request', async () => {
  const result = await run(['draft', '--channel-id', 'demo', '--text', 'Hello', '--dry-run'], {
    graphql: () => { throw new Error('Must not call API'); }, now,
  });
  assert.equal(result.dryRun, true);
  assert.equal(result.inputs[0].saveToDraft, true);
});

test('payload cannot override a draft command into a live queue operation', () => {
  assert.throws(() => normalizePostInput('draft', {}, { ...base, mode: 'queue' }, now), /must match/);
});

test('duplicate channel targets are rejected before any write', () => {
  assert.throws(() => normalizePostInput('draft', {}, { ...base, channelIds: ['x', 'x'] }, now), /Duplicate/);
});

test('offset schedule converts to UTC and past or timezone-less dates fail', () => {
  const post = normalizePostInput('schedule', {}, { ...base, dueAt: '2026-11-01T10:00:00+08:00' }, now);
  assert.equal(createPostInput('channel-a', post).dueAt, '2026-11-01T02:00:00.000Z');
  assert.throws(() => normalizePostInput('schedule', {}, { ...base, dueAt: '2026-10-15T00:00:00Z' }, now), /future/);
  assert.throws(() => timestamp('2026-11-01T10:00:00'), /explicit/);
  assert.throws(() => timestamp('2027-02-29T10:00:00Z'), /invalid calendar/);
  assert.equal(timestamp('2028-02-29T10:00:00Z'), '2028-02-29T10:00:00.000Z');
  assert.throws(() => normalizePostInput('draft', { dueAt: '2099-01-01T00:00:00Z' }, base, now), /only valid/);
});

test('local paths, embedded credentials, and ambiguous media are rejected', () => {
  for (const assets of [[{ image: { url: '/tmp/photo.png' } }],
    [{ image: { url: 'https://user:secret@example.com/a.png' } }],
    [{ image: { url: 'https://example.com/a.png' }, video: { url: 'https://example.com/a.mp4' } }]]) {
    assert.throws(() => normalizePostInput('draft', {}, { ...base, assets }, now));
  }
  assert.equal(normalizePostInput('draft', { imageUrl: 'https://example.com/image.png' }, base, now).assets.length, 0);
  assert.throws(() => normalizePostInput('draft', {}, { ...base, channelIds: 'wrong' }, now), /channel/);
});

test('argument mistakes and malformed JSON stop before connecting', async () => {
  assert.throws(() => parseArgs(['draft', '--text']), /Missing value/);
  assert.throws(() => parseArgs(['draft', '--text', 'A', '--text', 'B']), /Repeated/);
  assert.throws(() => parseArgs(['draft', '--typo', 'A']), /Unknown/);
  const graphql = () => { throw new Error('Must not connect'); };
  await assert.rejects(run(['verify', '--post-id', 'x', '--min-assets', '-1'], { graphql }), /non-negative/);
  await assert.rejects(run(['list', '--dry-run'], { graphql }), /not valid/);
  await assert.rejects(run(['draft', '--json-file', 'fake.json'], { graphql, read: async () => 'invalid' }), /UTF-8 JSON/);
});

test('creation is followed by authoritative read-back', async () => {
  const calls = [];
  const graphql = async (query, variables) => {
    calls.push({ query, variables });
    return query.startsWith('mutation') ? { createPost: { post: { id: saved.id } } } : { post: saved };
  };
  const result = await createPosts(graphql, normalizePostInput('draft', {}, base, now));
  assert.equal(result.ok, true);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].variables.input.saveToDraft, true);
  assert.equal(calls[1].variables.id, saved.id);
});

test('missing expected media fails verification and stops the next channel', async () => {
  let calls = 0;
  const graphql = async query => {
    calls++;
    return query.startsWith('mutation') ? { createPost: { post: { id: saved.id } } } : { post: saved };
  };
  const result = await createPosts(graphql, normalizePostInput('draft', {}, { ...base,
    channelIds: ['channel-a', 'channel-b'], assets: [{ image: { url: 'https://example.com/a.png' } }] }, now));
  assert.equal(result.ok, false);
  assert.equal(result.results[0].postId, saved.id);
  assert.match(result.results[0].issues.join(), /assetCount/);
  assert.deepEqual(result.skippedChannelIds, ['channel-b']);
  assert.equal(calls, 2);
});

test('partial batch failure preserves success, reports error, and skips remaining channels', async () => {
  let writes = 0;
  const graphql = async query => {
    if (!query.startsWith('mutation')) return { post: saved };
    writes++;
    return writes === 1 ? { createPost: { post: { id: saved.id } } } : { createPost: { message: 'Quota exceeded' } };
  };
  const result = await createPosts(graphql, normalizePostInput('draft', {}, { ...base,
    channelIds: ['channel-a', 'channel-b', 'channel-c'] }, now));
  assert.equal(result.ok, false);
  assert.equal(result.results[0].ok, true);
  assert.match(result.results[1].error, /Quota/);
  assert.deepEqual(result.skippedChannelIds, ['channel-c']);
  assert.equal(writes, 2);
});

test('lost verification response retains the newly created ID', async () => {
  const graphql = async query => {
    if (query.startsWith('mutation')) return { createPost: { post: { id: 'created-but-unverified' } } };
    throw new Error('Connection lost');
  };
  const result = await createPosts(graphql, normalizePostInput('draft', {}, base, now));
  assert.equal(result.ok, false);
  assert.equal(result.results[0].postId, 'created-but-unverified');
  assert.equal(result.results[0].stage, 'verify');
});

test('absent creation result never becomes success', async () => {
  const result = await createPosts(async () => ({ createPost: {} }), normalizePostInput('draft', {}, base, now));
  assert.equal(result.ok, false);
  assert.match(result.results[0].error, /post ID/);
});

test('verification catches mismatched text, channel, status, and media; equivalent times pass', () => {
  const issues = verificationIssues({ ...saved, dueAt: '2026-11-01T02:00:00Z', assetCount: 0 }, {
    expectedText: 'different', expectedChannelId: 'different', expectedStatus: 'scheduled', minAssets: 1,
    expectedDueAt: '2026-11-01T10:00:00+08:00',
  });
  assert.equal(issues.length, 4);
});

test('HTTP success with GraphQL errors fails without disclosing the key', async () => {
  const token = 'mock-sensitive-value';
  const graphql = createClient({ token, fetchImpl: async () => ({ ok: true, status: 200,
    json: async () => ({ errors: [{ message: `Denied ${token}` }] }) }) });
  await assert.rejects(graphql('query X { account { id } }'), error => {
    assert.ok(!error.message.includes(token));
    return /REDACTED/.test(error.message);
  });
});

test('typed mutation errors are redacted too', async () => {
  const token = 'mock-sensitive-value';
  const graphql = createClient({ token, fetchImpl: async () => ({ ok: true, status: 200,
    json: async () => ({ data: { createPost: { message: `Denied ${token}` } } }) }) });
  const result = await createPosts(graphql, normalizePostInput('draft', {}, base, now));
  assert.equal(result.ok, false);
  assert.ok(!JSON.stringify(result).includes(token));
});

test('HTTP error bodies and transport diagnostics cannot leak credentials, and writes are not retried', async () => {
  const token = 'mock-sensitive-value';
  let calls = 0;
  const graphql = createClient({ token, fetchImpl: async () => {
    calls++;
    throw new Error(`Unexpected failure ${token}`);
  } });
  await assert.rejects(graphql('mutation X { write }'), error => !error.message.includes(token));
  assert.equal(calls, 1);
  const denied = createClient({ token, fetchImpl: async () => ({ ok: false, status: 401,
    json: async () => ({ message: token }) }) });
  await assert.rejects(denied('query X { account { id } }'), error => /401/.test(error.message) && !error.message.includes(token));
});

test('CLI returns nonzero for validation errors and zero for offline preview', () => {
  const cli = fileURLToPath(new URL('../scripts/buffer_publish.mjs', import.meta.url));
  const environment = { ...process.env, BUFFER_API_KEY: '', BUFFER_API_KEY_FILE: '/nonexistent/buffer-key' };
  const invalid = spawnSync(process.execPath, [cli, 'schedule', '--channel-id', 'demo', '--text', 'Hello'], { env: environment, encoding: 'utf8' });
  assert.equal(invalid.status, 1);
  assert.equal(JSON.parse(invalid.stderr).ok, false);
  const preview = spawnSync(process.execPath, [cli, 'draft', '--channel-id', 'demo', '--text', 'Hello', '--dry-run'], { env: environment, encoding: 'utf8' });
  assert.equal(preview.status, 0);
  assert.equal(JSON.parse(preview.stdout).dryRun, true);
});

test('environment key takes precedence over a file without exposing its value', async () => {
  assert.equal(await loadToken({ BUFFER_API_KEY: ' mock-value ', BUFFER_API_KEY_FILE: '/not-used' }), 'mock-value');
});
