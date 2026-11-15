import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { chmod, mkdir, realpath, rm, symlink, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { makeTmpDir } from './_fixtures.js';
import {
  comparePrompt,
  planRegradeScenarios,
  readFirstUserPrompt,
  scanSourceRun,
  sourceRepProblem,
  type SourceRep,
} from '../src/regrade-source.js';

// Laid out as scuttlerun writes a transcript: one document opened by `---`,
// the header keys, the conversation entries, then the footer keys.
const HEADER = `---
session: abc
config:
  - /tmp/s/base.yaml
  - /tmp/s/scenario.yaml
project: /tmp/p
transcript: /tmp/x.jsonl
legend:
  entries:
    user: >-
      a synthetic-user message; the first is the scenario prompt, any leading
      slash command included
    assistant: the agent's reply text

conversation:
`;

const FOOTER = `

turns: 1
tool_calls: 0
duration_s: 1
cost_usd: 0.5
`;

const transcript = (entries: string) => HEADER + entries + FOOTER;

const FOLDED_PROMPT =
  'Please review the attached pull request and tell me whether the error handling is sound.';
const FOLDED = transcript(`  - user: >-
      Please review the attached pull request and tell me whether the error
      handling is sound.

  - assistant: Sure.
`);

const LITERAL_PROMPT =
  'Fix the failing test.\nThe test lives in tests/foo.test.ts and it fails because the parser drops a trailing newline when the input ends early.\nRun it after.\n';
const LITERAL = transcript(`  - user: |-
      Fix the failing test.
      The test lives in tests/foo.test.ts and it fails because the parser
      drops a trailing newline when the input ends early.
      Run it after.

  - assistant: Sure.
`);

const VALID_GRADING = `checks:
  - id: a1
    check: "c"
    pass: true
    evidence: "e"
pass_rate: 1
`;

describe('readFirstUserPrompt', () => {
  it('reads a folded single-line prompt', () => {
    expect(readFirstUserPrompt(FOLDED)).toBe(FOLDED_PROMPT);
  });

  it('reads a literal multi-line prompt as written, wraps included', () => {
    expect(readFirstUserPrompt(LITERAL)).toBe(
      'Fix the failing test.\nThe test lives in tests/foo.test.ts and it fails because the parser\ndrops a trailing newline when the input ends early.\nRun it after.',
    );
  });

  it('still reads the first entry when a later entry is malformed', () => {
    const truncated = HEADER + `  - user: hello\n\n  - tool: Bash\n    input: {"a": [1, 2\n`;
    expect(readFirstUserPrompt(truncated)).toBe('hello');
  });

  it('reads the first conversation when a later key repeats it', () => {
    expect(readFirstUserPrompt(FOLDED + 'conversation: again\n')).toBe(FOLDED_PROMPT);
  });

  it('is undefined when the conversation is absent or does not open with a user entry', () => {
    expect(readFirstUserPrompt(HEADER.replace('conversation:\n', ''))).toBeUndefined();
    expect(readFirstUserPrompt(transcript('  - assistant: hi\n'))).toBeUndefined();
    expect(readFirstUserPrompt(transcript('  - user: 42\n'))).toBeUndefined();
    expect(readFirstUserPrompt('conversation: none\n')).toBeUndefined();
    expect(readFirstUserPrompt('conversation: []\n')).toBeUndefined();
    expect(readFirstUserPrompt('conversation:\n  - hi\n')).toBeUndefined();
  });

  it('is undefined for text that is not a YAML mapping', () => {
    expect(readFirstUserPrompt('')).toBeUndefined();
    expect(readFirstUserPrompt('- a\n- b\n')).toBeUndefined();
    expect(readFirstUserPrompt('{{ not yaml :::')).toBeUndefined();
  });
});

describe('comparePrompt', () => {
  it('matches a prompt scuttlerun folded or hard-wrapped into the transcript', () => {
    expect(comparePrompt(FOLDED_PROMPT, readFirstUserPrompt(FOLDED))).toBe('same');
    expect(comparePrompt(LITERAL_PROMPT, readFirstUserPrompt(LITERAL))).toBe('same');
  });

  it('matches a short prompt exactly', () => {
    expect(comparePrompt('do it', 'do it')).toBe('same');
  });

  it('reports a changed word', () => {
    expect(comparePrompt(FOLDED_PROMPT.replace('sound', 'safe'), readFirstUserPrompt(FOLDED))).toBe(
      'changed',
    );
  });

  it('does not flag an edit that only changes whitespace', () => {
    expect(comparePrompt('do  it\n', 'do it')).toBe('same');
  });

  it('is unchecked when either prompt is unknown', () => {
    expect(comparePrompt(undefined, 'do it')).toBe('unchecked');
    expect(comparePrompt('do it', undefined)).toBe('unchecked');
  });
});

describe('planRegradeScenarios', () => {
  const root = (...ids: string[]) => ids.map((id) => ({ id, configPath: `/r/${id}` }));

  it('selects the scenarios both sides have and names the rest per side', () => {
    const plan = planRegradeScenarios(['alpha', 'beta', 'gamma'], root('beta', 'alpha', 'delta'));

    expect(plan.selected.map((s) => s.id)).toEqual(['beta', 'alpha']);
    expect(plan.selected[0].configPath).toBe('/r/beta');
    expect(plan.sourceOnly).toEqual(['gamma']);
    expect(plan.rootOnly).toEqual(['delta']);
  });

  it('selects nothing when the sides share no scenario', () => {
    const plan = planRegradeScenarios(['alpha'], root('beta'));

    expect(plan.selected).toEqual([]);
    expect(plan.sourceOnly).toEqual(['alpha']);
    expect(plan.rootOnly).toEqual(['beta']);
  });
});

describe('sourceRepProblem', () => {
  const rep = (overrides: Partial<SourceRep>): SourceRep => ({
    rep: 1,
    repDir: '/src/alpha/rep-1',
    hasTranscript: true,
    grading: 'ok',
    ...overrides,
  });

  it('is undefined for a rep with a transcript and a grading that parses', () => {
    expect(sourceRepProblem(rep({}))).toBeUndefined();
  });

  it('names a missing transcript and the source rep dir', () => {
    expect(sourceRepProblem(rep({ hasTranscript: false, grading: 'missing' }))).toBe(
      'source rep has no transcript (no output.yaml): /src/alpha/rep-1',
    );
  });

  it('names a missing grading', () => {
    expect(sourceRepProblem(rep({ grading: 'missing' }))).toBe(
      'source rep was not graded (no grading.yaml): /src/alpha/rep-1',
    );
  });

  it('names a grading that does not parse', () => {
    expect(sourceRepProblem(rep({ grading: 'invalid' }))).toBe(
      'source rep grading.yaml is not a valid grading: /src/alpha/rep-1',
    );
  });

  it('names a grading that could not be read, with its error code', () => {
    expect(sourceRepProblem(rep({ grading: 'unreadable', gradingReadError: 'EACCES' }))).toBe(
      'could not read the source grading.yaml (EACCES): /src/alpha/rep-1',
    );
  });

  it('names a failed copy of an otherwise regradable rep', () => {
    expect(sourceRepProblem(rep({}), 'EACCES: permission denied')).toBe(
      'could not copy the source transcript (EACCES: permission denied): /src/alpha/rep-1',
    );
  });
});

describe('scanSourceRun', () => {
  let tmpDir: string;

  beforeEach(async () => {
    tmpDir = await makeTmpDir('regrade-source');
  });

  afterEach(async () => {
    await rm(tmpDir, { recursive: true });
  });

  async function writeRep(id: string, rep: string, files: Record<string, string>) {
    const dir = join(tmpDir, id, rep);
    await mkdir(dir, { recursive: true });
    for (const [name, content] of Object.entries(files)) {
      await writeFile(join(dir, name), content);
    }
    return dir;
  }

  it('is missing when nothing is at the path', async () => {
    expect(await scanSourceRun(join(tmpDir, 'nope'))).toEqual({ kind: 'missing' });
  });

  it('rethrows a failure other than a missing path', async () => {
    await expect(scanSourceRun(join(tmpDir, 'x'.repeat(300)))).rejects.toThrow();
  });

  it('is not a directory for a file', async () => {
    const file = join(tmpDir, 'file');
    await writeFile(file, '');
    expect(await scanSourceRun(file)).toEqual({ kind: 'not-a-directory' });
  });

  it('is not a run for an empty dir or one with no <id>/rep-<N>/ dirs', async () => {
    expect(await scanSourceRun(tmpDir)).toEqual({ kind: 'not-a-run' });

    await mkdir(join(tmpDir, 'alpha', 'notes'), { recursive: true });
    await mkdir(join(tmpDir, 'alpha', 'rep-x'));
    await writeFile(join(tmpDir, 'loose.yaml'), '');
    expect(await scanSourceRun(tmpDir)).toEqual({ kind: 'not-a-run' });
  });

  it('holds no transcripts when its rep dirs hold neither a transcript nor a grading', async () => {
    await mkdir(join(tmpDir, 'alpha', 'rep-1'), { recursive: true });
    await writeRep('beta', 'rep-1', { 'notes.txt': '' });

    expect(await scanSourceRun(tmpDir)).toEqual({ kind: 'no-transcripts' });
  });

  it('records a grading.yaml it cannot read with the error code', async () => {
    await writeRep('alpha', 'rep-1', { 'output.yaml': FOLDED });
    await mkdir(join(tmpDir, 'alpha', 'rep-1', 'grading.yaml'));

    const result = await scanSourceRun(tmpDir);

    expect(result.kind).toBe('run');
    if (result.kind !== 'run') return;
    expect(result.scenarios.get('alpha')).toEqual([
      {
        rep: 1,
        repDir: join(tmpDir, 'alpha', 'rep-1'),
        hasTranscript: true,
        grading: 'unreadable',
        gradingReadError: 'EISDIR',
      },
    ]);
  });

  describe.skipIf(process.getuid?.() === 0)('without read permission', () => {
    it('skips a subdir it cannot list', async () => {
      await writeRep('alpha', 'rep-1', { 'output.yaml': FOLDED, 'grading.yaml': VALID_GRADING });
      const locked = join(tmpDir, 'locked');
      await mkdir(locked);
      await chmod(locked, 0o000);

      try {
        const result = await scanSourceRun(tmpDir);

        expect(result.kind).toBe('run');
        if (result.kind !== 'run') return;
        expect([...result.scenarios.keys()]).toEqual(['alpha']);
      } finally {
        await chmod(locked, 0o755);
      }
    });

    it('is unreadable when the dir itself cannot be listed', async () => {
      await chmod(tmpDir, 0o000);

      try {
        expect(await scanSourceRun(tmpDir)).toEqual({ kind: 'unreadable', code: 'EACCES' });
      } finally {
        await chmod(tmpDir, 0o755);
      }
    });
  });

  it('lists every rep dir of each scenario in rep order, with what it holds', async () => {
    await writeRep('alpha', 'rep-10', { 'output.yaml': FOLDED, 'grading.yaml': VALID_GRADING });
    await writeRep('alpha', 'rep-2', { 'output.yaml': FOLDED });
    await writeRep('alpha', 'rep-3', { 'output.yaml': FOLDED, 'grading.yaml': 'pass_rate: 1\n' });
    await writeRep('alpha', 'rep-4', {});
    await writeRep('alpha', 'rep-01', { 'output.yaml': FOLDED });
    await writeRep('alpha', 'rep-x', { 'output.yaml': FOLDED });
    await writeFile(join(tmpDir, 'alpha', 'rep-5'), '');
    await mkdir(join(tmpDir, 'empty'));

    const result = await scanSourceRun(tmpDir);

    expect(result.kind).toBe('run');
    if (result.kind !== 'run') return;
    expect(result.realDir).toBe(await realpath(tmpDir));
    expect([...result.scenarios.keys()]).toEqual(['alpha']);
    const alpha = join(tmpDir, 'alpha');
    expect(result.scenarios.get('alpha')).toEqual([
      { rep: 2, repDir: join(alpha, 'rep-2'), hasTranscript: true, grading: 'missing' },
      { rep: 3, repDir: join(alpha, 'rep-3'), hasTranscript: true, grading: 'invalid' },
      { rep: 4, repDir: join(alpha, 'rep-4'), hasTranscript: false, grading: 'missing' },
      { rep: 10, repDir: join(alpha, 'rep-10'), hasTranscript: true, grading: 'ok' },
    ]);
  });

  it('orders scenarios by id and resolves a source named through a symlink', async () => {
    await writeRep('beta', 'rep-1', { 'grading.yaml': VALID_GRADING });
    await writeRep('alpha', 'rep-1', { 'output.yaml': FOLDED });
    const link = `${tmpDir}-link`;
    await symlink(tmpDir, link);

    try {
      const result = await scanSourceRun(link);

      expect(result.kind).toBe('run');
      if (result.kind !== 'run') return;
      expect(result.realDir).toBe(await realpath(tmpDir));
      expect([...result.scenarios.keys()]).toEqual(['alpha', 'beta']);
      expect(result.scenarios.get('alpha')?.[0].repDir).toBe(join(link, 'alpha', 'rep-1'));
    } finally {
      await rm(link);
    }
  });
});
