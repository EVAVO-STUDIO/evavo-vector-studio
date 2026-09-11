import { execFileSync } from 'node:child_process';
import { mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { createHash } from 'node:crypto';

const root = resolve(process.cwd());
const output = resolve(process.env.EVAVO_VECTOR_EXPORT_DIR ?? `${root}.evavo-exports`);

function git(...args) {
  return execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim();
}

const branch = git('branch', '--show-current');
const head = git('rev-parse', 'HEAD');
const originMain = git('rev-parse', 'refs/remotes/origin/main');
const status = git('status', '--porcelain=v1', '--untracked-files=all');
if (branch !== 'main') throw new Error(`expected main, observed ${branch || 'detached'}`);
if (head !== originMain) throw new Error(`HEAD ${head} does not equal origin/main ${originMain}`);
if (status) throw new Error('worktree must be clean before exact-source export');

mkdirSync(output, { recursive: false });
const archive = resolve(output, `evavo-vector-studio-${head}.zip`);
const commitFile = resolve(output, 'COMMIT_SHA');
const sums = resolve(output, 'SHA256SUMS');
execFileSync('git', ['archive', '--format=zip', `--output=${archive}`, 'HEAD'], { cwd: root });
const digest = createHash('sha256').update(readFileSync(archive)).digest('hex');
writeFileSync(commitFile, `${head}\n`, { encoding: 'utf8', flag: 'wx' });
writeFileSync(sums, `${digest}  ${archive.split('\\').pop()}\n`, { encoding: 'utf8', flag: 'wx' });
const stat = statSync(archive);
const receipt = {
  contractVersion: 'evavo_vector_exact_source_export_v1',
  repository: 'EVAVO-STUDIO/evavo-vector-studio',
  branch,
  head,
  originMain,
  archive,
  archiveBytes: stat.size,
  sha256: digest,
  githubActionsAuthority: false,
  status: 'passed',
};
const receiptPath = resolve(output, 'receipt.json');
writeFileSync(receiptPath, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: 'utf8', flag: 'wx' });
console.log(JSON.stringify(receipt, null, 2));
