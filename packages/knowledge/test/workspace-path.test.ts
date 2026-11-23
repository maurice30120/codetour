import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { canonicalWorkspacePath, sameWorkspace, stripTrailingSeparator } from '../src/index';

// The rule's answer is the native real path (ADR 0056), which is also the
// fixture's spelling: on Windows the JavaScript resolution keeps an 8.3 name
// the rule expands.
const root = (prefix: string): string => realpathSync.native(mkdtempSync(join(tmpdir(), prefix)));

test('the canonical workspace strips the trailing separator and resolves the path', () => {
  const directory = root('knowledge-workspace-');
  try {
    const nested = join(directory, 'a', '..', 'repo');
    mkdirSync(join(directory, 'repo'));
    assert.equal(canonicalWorkspacePath(`${nested}/`), join(directory, 'repo'));
    assert.equal(canonicalWorkspacePath(directory), directory, 'an already canonical root is itself');
    assert.equal(stripTrailingSeparator('/'), '/', 'the filesystem root keeps its separator');
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});

test('two spellings of one workspace compare equal, and two roots never do', () => {
  const directory = root('knowledge-workspace-link-');
  const other = root('knowledge-workspace-other-');
  try {
    mkdirSync(join(directory, 'repo'));
    const link = join(directory, 'linked');
    symlinkSync(join(directory, 'repo'), link, 'dir');
    assert.equal(sameWorkspace(link, join(directory, 'repo')), true, 'a symlink names its target');
    assert.equal(sameWorkspace(`${link}/`, join(directory, 'repo', '')), true);
    assert.equal(sameWorkspace(link, other), false);
  } finally {
    rmSync(directory, { recursive: true, force: true });
    rmSync(other, { recursive: true, force: true });
  }
});

test('an unavailable real path falls back to the resolved argument without throwing', () => {
  const missing = join(tmpdir(), 'knowledge-workspace-absent', 'gone');
  assert.equal(canonicalWorkspacePath(missing), missing);
  assert.equal(sameWorkspace(missing, missing), true);
});

test('the canonical spelling is the file system answer, not the argument', () => {
  // The rule exists because Node has two realpath implementations and they
  // disagree on an 8.3 short name: the canonical form must come from the
  // native one, which every surface then uses (ADR 0056). Only a Windows
  // machine can exhibit a short name, so the platform-neutral property is
  // checked here: the answer is a real path, never the argument verbatim.
  const directory = root('knowledge-workspace-native-');
  try {
    mkdirSync(join(directory, 'repo'));
    const composed = join(directory, 'repo', '..', 'repo');
    assert.equal(canonicalWorkspacePath(composed), realpathSync.native(join(directory, 'repo')));
  } finally {
    rmSync(directory, { recursive: true, force: true });
  }
});
