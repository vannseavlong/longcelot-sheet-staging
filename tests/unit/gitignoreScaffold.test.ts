import fs from 'fs';
import os from 'os';
import path from 'path';
import { ensureGitignoreEntries } from '../../src/cli/commands/init';

describe('ensureGitignoreEntries', () => {
  let cwd: string;
  let tmpDir: string;

  beforeEach(() => {
    tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lsdb-gitignore-'));
    cwd = process.cwd();
    process.chdir(tmpDir);
  });

  afterEach(() => {
    process.chdir(cwd);
    fs.rmSync(tmpDir, { recursive: true, force: true });
  });

  it('creates .gitignore with the given entries when none exists', () => {
    ensureGitignoreEntries(['.env', '.lsdb-tokens.json']);
    const content = fs.readFileSync('.gitignore', 'utf-8');
    expect(content).toContain('.env');
    expect(content).toContain('.lsdb-tokens.json');
  });

  it('appends missing entries to an existing .gitignore without touching existing content', () => {
    fs.writeFileSync('.gitignore', 'dist/\nnode_modules\n');
    ensureGitignoreEntries(['.env', '.lsdb-tokens.json', 'node_modules']);

    const content = fs.readFileSync('.gitignore', 'utf-8');
    expect(content).toContain('dist/');
    expect(content).toContain('.env');
    expect(content).toContain('.lsdb-tokens.json');
    // node_modules was already present — must not be duplicated
    expect(content.split('node_modules').length - 1).toBe(1);
  });

  it('is a no-op when every entry is already present', () => {
    fs.writeFileSync('.gitignore', '.env\n.lsdb-tokens.json\n');
    const before = fs.readFileSync('.gitignore', 'utf-8');
    ensureGitignoreEntries(['.env', '.lsdb-tokens.json']);
    const after = fs.readFileSync('.gitignore', 'utf-8');
    expect(after).toBe(before);
  });
});
