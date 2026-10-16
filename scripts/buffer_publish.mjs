#!/usr/bin/env node
import { readFile } from 'node:fs/promises';
import { homedir } from 'node:os';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

const ENDPOINT = 'https://api.buffer.com';
const WRITE_COMMANDS = ['draft', 'queue', 'schedule'];
const VALUE_OPTIONS = new Set(['channel-id', 'text', 'due-at', 'json-file', 'image-url', 'video-url',
  'post-id', 'post-ids', 'expected-status', 'expected-due-at', 'expected-channel-id', 'min-assets']);
const FLAG_OPTIONS = new Set(['dry-run', 'help', 'version']);
const camel = key => key.replace(/-([a-z])/g, (_, c) => c.toUpperCase());

export function parseArgs(args) {
  const [command = 'help', ...rest] = args;
  const options = { command };
  for (let i = 0; i < rest.length; i++) {
    const key = rest[i].replace(/^--/, '');
    if (!rest[i].startsWith('--') || (!VALUE_OPTIONS.has(key) && !FLAG_OPTIONS.has(key))) {
      throw new Error(`Unknown argument: ${rest[i]}`);
    }
    if (Object.hasOwn(options, camel(key))) throw new Error(`Repeated option: --${key}`);
    if (FLAG_OPTIONS.has(key)) options[camel(key)] = true;
    else {
      const value = rest[++i];
      if (value === undefined || value.startsWith('--')) throw new Error(`Missing value for --${key}`);
      options[camel(key)] = value;
    }
  }
  return options;
}

function nonempty(value, label) {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${label} must be a non-empty string.`);
  return value;
}

export function timestamp(value, label = 'dueAt') {
  nonempty(value, label);
  const parts = value.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(\.\d{1,3})?(Z|[+-]\d{2}:\d{2})$/);
  if (!parts
      || !Number.isFinite(Date.parse(value))) {
    throw new Error(`${label} must be an ISO 8601 timestamp with Z or an explicit UTC offset.`);
  }
  const [year, month, day, hour, minute, second] = parts.slice(1, 7).map(Number);
  const leap = year % 4 === 0 && (year % 100 !== 0 || year % 400 === 0);
  const days = [31, leap ? 29 : 28, 31, 30, 31, 30, 31, 31, 30, 31, 30, 31];
  if (month < 1 || month > 12 || day < 1 || day > days[month - 1] || hour > 23 || minute > 59 || second > 59) {
    throw new Error(`${label} contains an invalid calendar date or time.`);
  }
  return new Date(value).toISOString();
}

function validateAssets(assets) {
  if (!Array.isArray(assets)) throw new Error('assets must be an array.');
  return assets.map(asset => {
    if (!asset || typeof asset !== 'object' || Array.isArray(asset)) throw new Error('Invalid asset.');
    const types = Object.keys(asset);
    if (types.length !== 1 || !['image', 'video', 'document'].includes(types[0])) {
      throw new Error('Each asset must contain exactly one of image, video, or document.');
    }
    const item = asset[types[0]];
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('Invalid asset details.');
    let url;
    try { url = new URL(item.url); } catch { throw new Error('Each asset needs an absolute HTTPS URL.'); }
    if (url.protocol !== 'https:' || url.username || url.password) throw new Error('Asset URLs must use HTTPS without embedded credentials.');
    return asset;
  });
}

export function normalizePostInput(command, options, payload = {}, now = Date.now()) {
  if (!WRITE_COMMANDS.includes(command)) throw new Error(`Unsupported command: ${command}`);
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) throw new Error('Payload must be a JSON object.');
  const allowed = new Set(['channelIds', 'text', 'assets', 'dueAt', 'mode']);
  for (const key of Object.keys(payload)) if (!allowed.has(key)) throw new Error(`Unknown payload field: ${key}`);
  if (payload.mode !== undefined && payload.mode !== command) throw new Error('payload.mode must match the command.');
  const channelIds = payload.channelIds ?? (options.channelId ? [options.channelId] : []);
  if (!Array.isArray(channelIds) || channelIds.length === 0) throw new Error('Provide --channel-id or payload.channelIds.');
  channelIds.forEach(id => nonempty(id, 'Channel ID'));
  if (new Set(channelIds).size !== channelIds.length) throw new Error('Duplicate channel IDs would create duplicate posts.');
  const text = nonempty(payload.text ?? options.text, 'Post text');
  const assets = validateAssets(payload.assets ?? [
    ...(options.imageUrl ? [{ image: { url: options.imageUrl } }] : []),
    ...(options.videoUrl ? [{ video: { url: options.videoUrl } }] : []),
  ]);
  const rawDueAt = payload.dueAt ?? options.dueAt;
  let dueAt;
  if (command === 'schedule') {
    dueAt = timestamp(rawDueAt);
    if (Date.parse(dueAt) <= now) throw new Error('Scheduled time must be in the future.');
  } else if (rawDueAt !== undefined) throw new Error('dueAt is only valid with schedule.');
  return { channelIds, text, assets, dueAt, mode: command };
}

export function createPostInput(channelId, post) {
  const input = { assets: post.assets, channelId, mode: 'addToQueue', schedulingType: 'automatic', text: post.text };
  if (post.mode === 'draft') input.saveToDraft = true;
  else if (post.mode === 'schedule') { input.mode = 'customScheduled'; input.dueAt = post.dueAt; }
  else if (post.mode !== 'queue') throw new Error('Unsupported post mode.');
  return input;
}

export async function loadToken(environment = process.env) {
  if (environment.BUFFER_API_KEY?.trim()) return environment.BUFFER_API_KEY.trim();
  const file = environment.BUFFER_API_KEY_FILE || resolve(homedir(), '.codex/secrets/buffer-publisher.env');
  try {
    const content = await readFile(file, 'utf8');
    const value = content.match(/^\s*(?:export\s+)?BUFFER_API_KEY\s*=\s*(.+?)\s*$/m)?.[1];
    if (value) return value.replace(/^(["'])(.*)\1$/, '$2').trim();
  } catch (error) {
    if (error.code !== 'ENOENT') throw new Error('Cannot read the Buffer key file. Check its path and permissions.');
  }
  throw new Error('Set BUFFER_API_KEY or BUFFER_API_KEY_FILE. Never put your key in a post JSON file.');
}

export function createClient({ token, fetchImpl = globalThis.fetch }) {
  nonempty(token, 'API key');
  const redact = value => String(value).split(token).join('[REDACTED]');
  return async (query, variables = {}) => {
    let response;
    try {
      response = await fetchImpl(ENDPOINT, { method: 'POST', redirect: 'error',
        headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query, variables }), signal: AbortSignal.timeout(30_000) });
    } catch {
      throw new Error('Buffer request failed or timed out. If it was a write, check Buffer before retrying.');
    }
    let body;
    try { body = await response.json(); }
    catch { throw new Error(`Buffer returned a non-JSON response (HTTP ${response.status}).`); }
    if (!response.ok) throw new Error(`Buffer HTTP ${response.status}. Check authentication, quota, and service status.`);
    if (body.errors?.length) throw new Error(`Buffer GraphQL error: ${body.errors.map(e => redact(e.message)).join('; ')}`);
    if (!body.data || typeof body.data !== 'object') throw new Error('Buffer returned no data.');
    if (body.data.createPost?.message) body.data.createPost.message = redact(body.data.createPost.message);
    return body.data;
  };
}

export async function listChannels(graphql) {
  const data = await graphql('query GetOrganizations { account { organizations { id name } } }');
  if (!Array.isArray(data.account?.organizations)) throw new Error('Buffer returned no organization list.');
  const result = [];
  for (const org of data.account.organizations) {
    const channels = await graphql(`query GetChannels($organizationId: OrganizationId!) {
      channels(input: { organizationId: $organizationId }) { id name service }
    }`, { organizationId: org.id });
    if (!Array.isArray(channels.channels)) throw new Error('Buffer returned no channel list.');
    result.push({ ...org, channels: channels.channels });
  }
  return result;
}

export async function getPost(graphql, id) {
  const data = await graphql(`query GetPost($id: PostId!) {
    post(input: { id: $id }) { id status dueAt text channelId assets { mimeType source thumbnail } }
  }`, { id });
  const post = data.post;
  if (!post?.id || !Array.isArray(post.assets)) throw new Error('Post or asset information is unavailable.');
  return { ...post, assetCount: post.assets.length };
}

export function verificationIssues(post, options) {
  const issues = [];
  if (options.expectedStatus && post.status !== options.expectedStatus) issues.push(`status=${post.status}, expected ${options.expectedStatus}`);
  if (options.expectedChannelId && post.channelId !== options.expectedChannelId) issues.push('Channel does not match.');
  if (options.expectedDueAt && (!post.dueAt || timestamp(post.dueAt) !== timestamp(options.expectedDueAt))) issues.push('Scheduled time does not match.');
  if (options.minAssets !== undefined && post.assetCount < Number(options.minAssets)) issues.push(`assetCount=${post.assetCount}, expected at least ${options.minAssets}`);
  if (options.expectedText !== undefined && post.text !== options.expectedText) issues.push('Post text does not match.');
  return issues;
}

export async function createPosts(graphql, post) {
  const results = [];
  for (const channelId of post.channelIds) {
    let id;
    let stage = 'create';
    try {
      const data = await graphql(`mutation CreatePost($input: CreatePostInput!) {
        createPost(input: $input) {
          ... on PostActionSuccess { post { id } }
          ... on MutationError { message }
        }
      }`, { input: createPostInput(channelId, post) });
      if (data.createPost?.message) throw new Error(data.createPost.message);
      id = data.createPost?.post?.id;
      if (!id) throw new Error('Buffer did not return a post ID. Check Buffer before retrying.');
      stage = 'verify';
      const saved = await getPost(graphql, id);
      const issues = verificationIssues(saved, { expectedChannelId: channelId, expectedText: post.text,
        expectedStatus: post.mode === 'draft' ? 'draft' : 'scheduled',
        expectedDueAt: post.mode === 'schedule' ? post.dueAt : undefined, minAssets: post.assets.length });
      results.push({ channelId, postId: id, ok: issues.length === 0, stage, post: saved, issues });
      if (issues.length) break;
    } catch (error) {
      results.push({ channelId, postId: id, ok: false, stage, error: error.message });
      break;
    }
  }
  return { ok: results.length === post.channelIds.length && results.every(item => item.ok), results,
    skippedChannelIds: post.channelIds.slice(results.length) };
}

function validateOptions(command, options) {
  const writes = ['channelId', 'text', 'dueAt', 'jsonFile', 'imageUrl', 'videoUrl', 'dryRun'];
  const reads = ['postId', 'postIds'];
  const verifies = [...reads, 'expectedStatus', 'expectedDueAt', 'expectedChannelId', 'minAssets'];
  const allowed = WRITE_COMMANDS.includes(command) ? writes : command === 'verify' ? verifies : command === 'get' ? reads : [];
  for (const key of Object.keys(options)) if (!['command', 'help', 'version', ...allowed].includes(key)) throw new Error(`Option ${key} is not valid with ${command}.`);
  if (options.expectedDueAt !== undefined) timestamp(options.expectedDueAt, 'expectedDueAt');
  if (options.minAssets !== undefined && (!/^\d+$/.test(options.minAssets) || !Number.isSafeInteger(Number(options.minAssets)))) {
    throw new Error('--min-assets must be a non-negative integer.');
  }
}

export async function run(args, { graphql, read = readFile, now = Date.now() } = {}) {
  const options = parseArgs(args);
  const { command } = options;
  if (command === 'help' || command === '--help' || options.help) return { ok: true, help: usage() };
  if (command === '--version' || options.version) return { ok: true, version: '1.0.0' };
  if (!['list', 'get', 'verify', ...WRITE_COMMANDS].includes(command)) throw new Error(`Unknown command: ${command}`);
  validateOptions(command, options);
  let post;
  let ids;
  if (WRITE_COMMANDS.includes(command)) {
    let payload = {};
    if (options.jsonFile) {
      try { payload = JSON.parse(await read(options.jsonFile, 'utf8')); }
      catch { throw new Error('Cannot read --json-file as UTF-8 JSON.'); }
    }
    post = normalizePostInput(command, options, payload, now);
    if (options.dryRun) return { ok: true, dryRun: true, inputs: post.channelIds.map(id => createPostInput(id, post)) };
  } else if (command !== 'list') {
    ids = [...new Set([...(options.postId ? [options.postId] : []),
      ...(options.postIds ? options.postIds.split(',').map(id => id.trim()).filter(Boolean) : [])])];
    if (!ids.length) throw new Error('Provide --post-id or --post-ids.');
  }
  graphql ??= createClient({ token: await loadToken() });
  if (post) return createPosts(graphql, post);
  if (command === 'list') return { ok: true, organizations: await listChannels(graphql) };
  const posts = [];
  for (const id of ids) {
    const saved = await getPost(graphql, id);
    const issues = command === 'verify' ? verificationIssues(saved, options) : [];
    posts.push({ ...saved, ok: issues.length === 0, issues });
  }
  return { ok: posts.every(p => p.ok), posts };
}

function usage() {
  return [
    'node scripts/buffer_publish.mjs list',
    'node scripts/buffer_publish.mjs draft --channel-id CHANNEL_ID --text TEXT [--dry-run]',
    'node scripts/buffer_publish.mjs queue --channel-id CHANNEL_ID --text TEXT [--dry-run]',
    'node scripts/buffer_publish.mjs schedule --channel-id CHANNEL_ID --text TEXT --due-at ISO_TIME [--dry-run]',
    'node scripts/buffer_publish.mjs draft --json-file examples/draft.json --dry-run',
    'node scripts/buffer_publish.mjs get --post-id POST_ID',
    'node scripts/buffer_publish.mjs verify --post-id POST_ID --expected-status scheduled --expected-channel-id CHANNEL_ID --min-assets 1',
    'Optional: --image-url HTTPS_URL, --video-url HTTPS_URL, --post-ids ID1,ID2, --expected-due-at ISO_TIME',
  ];
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const result = await run(process.argv.slice(2));
    console.log(JSON.stringify(result, null, 2));
    if (!result.ok) process.exitCode = 1;
  } catch (error) {
    console.error(JSON.stringify({ ok: false, error: error.message }, null, 2));
    process.exitCode = 1;
  }
}
