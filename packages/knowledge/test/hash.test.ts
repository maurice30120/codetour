import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdir, mkdtemp, rm, symlink, writeFile } from 'node:fs/promises';
import { realpathSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { hashWorkspaceFile } from '../src/index';

async function realRoot(prefix: string): Promise<string> {
  return realpathSync(await mkdtemp(join(tmpdir(), prefix)));
}

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');

test('hashing a workspace file is deterministic and reports the workspace-relative path', async t => {
  const root = await realRoot('knowledge-hash-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'src'));
  await writeFile(join(root, 'src', 'main.ts'), 'cited bytes\n');
  const hashed = await hashWorkspaceFile(root, 'src/main.ts');
  assert.deepEqual(hashed, { status: 'ok', path: join('src', 'main.ts'), sha256: sha256('cited bytes\n') });
  // Hashing is pure: a second call sees the same bytes and the same digest.
  assert.deepEqual(await hashWorkspaceFile(root, join('.', 'src', 'main.ts')), hashed);
});

test('hashing refuses a missing file, a directory, an outside path and an escaping symbolic link', async t => {
  const root = await realRoot('knowledge-hash-refuse-');
  t.after(() => rm(root, { recursive: true, force: true }));
  await mkdir(join(root, 'dir'));
  const outsideRoot = await realRoot('knowledge-hash-outside-');
  t.after(() => rm(outsideRoot, { recursive: true, force: true }));
  const outside = join(outsideRoot, 'secret.txt');
  await writeFile(outside, 'secret\n');
  await symlink(outside, join(root, 'linked.txt'));
  assert.deepEqual(await hashWorkspaceFile(root, 'gone.ts'), { status: 'absent', reason: 'file_missing' });
  assert.deepEqual(await hashWorkspaceFile(root, 'dir'), { status: 'invalid', reason: 'not_a_file' });
  assert.deepEqual(await hashWorkspaceFile(root, '../escape.txt'), { status: 'invalid', reason: 'path_outside_workspace' });
  assert.deepEqual(await hashWorkspaceFile(root, outside), { status: 'invalid', reason: 'path_outside_workspace' });
  assert.deepEqual(await hashWorkspaceFile(root, 'linked.txt'), { status: 'invalid', reason: 'symlink_escape' });
});
