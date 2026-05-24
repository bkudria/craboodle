import { describe, it, expect, vi, beforeEach } from 'vitest';

describe('output', () => {
  let written: string;
  beforeEach(() => {
    written = '';
    vi.spyOn(process.stdout, 'write').mockImplementation((chunk: string | Uint8Array) => {
      written += typeof chunk === 'string' ? chunk : chunk.toString();
      return true;
    });
  });

  describe('parseCostFromTranscript', () => {
    it('extracts cost_usd from scuttlerun transcript YAML', async () => {
      const { parseCostFromTranscript } = await import('../src/output.js');
      const yaml = `session: abc\ncost_usd: 0.0523\nturns: 2`;
      expect(parseCostFromTranscript(yaml)).toBe(0.0523);
    });

    it('returns null when cost_usd is missing', async () => {
      const { parseCostFromTranscript } = await import('../src/output.js');
      const yaml = `session: abc\nturns: 2`;
      expect(parseCostFromTranscript(yaml)).toBeNull();
    });

    it('returns null when cost_usd is not a number', async () => {
      const { parseCostFromTranscript } = await import('../src/output.js');
      const yaml = `cost_usd: "expensive"`;
      expect(parseCostFromTranscript(yaml)).toBeNull();
    });

    it('returns null for invalid YAML', async () => {
      const { parseCostFromTranscript } = await import('../src/output.js');
      expect(parseCostFromTranscript('{{invalid')).toBeNull();
    });
  });

  describe('parseGrading', () => {
    it('extracts check results from pincenez YAML output', async () => {
      const { parseGrading } = await import('../src/output.js');

      const yaml = `checks:
  - id: a1
    check: "Output contains a function"
    pass: true
    evidence: "Function found"
  - id: a2
    check: "Handles edge cases"
    pass: false
    evidence: "No empty string handling"
pass_rate: 0.5
`;

      const result = parseGrading(yaml);

      expect(result.checks).toHaveLength(2);
      expect(result.checks[0]).toEqual({
        id: 'a1',
        check: 'Output contains a function',
        pass: true,
        evidence: 'Function found',
      });
      expect(result.checks[1]).toEqual({
        id: 'a2',
        check: 'Handles edge cases',
        pass: false,
        evidence: 'No empty string handling',
      });
      expect(result.costUsd).toBeNull();
    });

    it('handles null pass values', async () => {
      const { parseGrading } = await import('../src/output.js');

      const yaml = `checks:
  - id: a1
    check: "test"
    pass: null
    evidence: "error: could not extract verdict"
pass_rate: 0
`;

      const result = parseGrading(yaml);

      expect(result.checks[0].pass).toBeNull();
    });

    it('throws on malformed grading YAML (missing checks)', async () => {
      const { parseGrading } = await import('../src/output.js');

      const yaml = `pass_rate: 1.0\n`;

      expect(() => parseGrading(yaml)).toThrow();
    });

    it('throws on grading with invalid check structure', async () => {
      const { parseGrading } = await import('../src/output.js');

      const yaml = `checks:
  - wrong_field: true
pass_rate: 1
`;

      expect(() => parseGrading(yaml)).toThrow();
    });

    it('extracts cost_usd from pincenez YAML when present', async () => {
      const { parseGrading } = await import('../src/output.js');

      const yaml = `checks:
  - id: a1
    check: "test"
    pass: true
    evidence: "ok"
pass_rate: 1
cost_usd: 0.0042
`;

      const result = parseGrading(yaml);

      expect(result.costUsd).toBe(0.0042);
    });
  });

  describe('averageResults', () => {
    it('returns empty results for empty input', async () => {
      const { averageResults } = await import('../src/output.js');

      const result = averageResults([]);

      expect(result.checks).toEqual([]);
      expect(result.pass_rate).toBe(0);
    });

    it('returns 0 pass_rate when checks array is empty per rep', async () => {
      const { averageResults } = await import('../src/output.js');

      // A rep with zero checks (edge case)
      const result = averageResults([[]]);

      expect(result.checks).toEqual([]);
      expect(result.pass_rate).toBe(0);
    });

    it('computes pass_rate for a single rep', async () => {
      const { averageResults } = await import('../src/output.js');

      const repGradings = [
        [
          { id: 'a1', check: 'test1', pass: true, evidence: 'ok' },
          { id: 'a2', check: 'test2', pass: false, evidence: 'no' },
        ],
      ];

      const result = averageResults(repGradings);

      expect(result.checks[0].pass_rate).toBe(1.0);
      expect(result.checks[1].pass_rate).toBe(0.0);
      expect(result.pass_rate).toBe(0.5);
    });

    it('averages across multiple reps', async () => {
      const { averageResults } = await import('../src/output.js');

      const repGradings = [
        [{ id: 'a1', check: 'test', pass: true, evidence: 'ok' }],
        [{ id: 'a1', check: 'test', pass: false, evidence: 'no' }],
        [{ id: 'a1', check: 'test', pass: true, evidence: 'ok' }],
      ];

      const result = averageResults(repGradings);

      expect(result.checks[0].pass_rate).toBeCloseTo(0.67, 2);
    });

    it('treats null as failure (0)', async () => {
      const { averageResults } = await import('../src/output.js');

      const repGradings = [
        [{ id: 'a1', check: 'test', pass: true, evidence: 'ok' }],
        [{ id: 'a1', check: 'test', pass: null, evidence: 'error' }],
      ];

      const result = averageResults(repGradings);

      expect(result.checks[0].pass_rate).toBe(0.5);
    });

    it('computes scenario pass_rate as mean of check pass_rates', async () => {
      const { averageResults } = await import('../src/output.js');

      const repGradings = [
        [
          { id: 'a1', check: 'always pass', pass: true, evidence: 'ok' },
          { id: 'a2', check: 'always fail', pass: false, evidence: 'no' },
        ],
      ];

      const result = averageResults(repGradings);

      expect(result.pass_rate).toBe(0.5);
    });

    it('joins reps by check id, not by index (handles reordered reps)', async () => {
      const { averageResults } = await import('../src/output.js');

      const repGradings = [
        [
          { id: 'a1', check: 'always pass', pass: true, evidence: 'ok' },
          { id: 'a2', check: 'always fail', pass: false, evidence: 'no' },
        ],
        [
          { id: 'a2', check: 'always fail', pass: false, evidence: 'no' },
          { id: 'a1', check: 'always pass', pass: true, evidence: 'ok' },
        ],
      ];

      const result = averageResults(repGradings);

      const a1 = result.checks.find((c) => c.check === 'always pass');
      const a2 = result.checks.find((c) => c.check === 'always fail');
      expect(a1?.pass_rate).toBe(1.0);
      expect(a2?.pass_rate).toBe(0.0);
    });

    it('treats a check missing from a rep as non-pass for that rep and warns to stderr', async () => {
      const { averageResults } = await import('../src/output.js');
      const writes: string[] = [];
      const warn = vi
        .spyOn(process.stderr, 'write')
        .mockImplementation((chunk: string | Uint8Array) => {
          writes.push(typeof chunk === 'string' ? chunk : chunk.toString());
          return true;
        });

      const repGradings = [
        [
          { id: 'a1', check: 'test1', pass: true, evidence: 'ok' },
          { id: 'a2', check: 'test2', pass: true, evidence: 'ok' },
        ],
        [{ id: 'a1', check: 'test1', pass: true, evidence: 'ok' }],
      ];

      const result = averageResults(repGradings);

      const a1 = result.checks.find((c) => c.check === 'test1');
      const a2 = result.checks.find((c) => c.check === 'test2');
      expect(a1?.pass_rate).toBe(1.0);
      expect(a2?.pass_rate).toBe(0.5);

      const joined = writes.join('');
      expect(joined).toContain('missing');
      expect(joined).toContain('a2');

      warn.mockRestore();
    });

    it('includes extra checks from later reps in output and warns to stderr', async () => {
      const { averageResults } = await import('../src/output.js');
      const writes: string[] = [];
      const warn = vi
        .spyOn(process.stderr, 'write')
        .mockImplementation((chunk: string | Uint8Array) => {
          writes.push(typeof chunk === 'string' ? chunk : chunk.toString());
          return true;
        });

      const repGradings = [
        [{ id: 'a1', check: 'test1', pass: true, evidence: 'ok' }],
        [
          { id: 'a1', check: 'test1', pass: true, evidence: 'ok' },
          { id: 'a2', check: 'test2', pass: true, evidence: 'ok' },
        ],
      ];

      const result = averageResults(repGradings);

      const a1 = result.checks.find((c) => c.check === 'test1');
      const a2 = result.checks.find((c) => c.check === 'test2');
      expect(a1?.pass_rate).toBe(1.0);
      expect(a2?.pass_rate).toBe(0.5);

      const joined = writes.join('');
      expect(joined).toContain('extra');
      expect(joined).toContain('a2');

      warn.mockRestore();
    });

    it('does not warn when all reps have the same check id set', async () => {
      const { averageResults } = await import('../src/output.js');
      const warn = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);

      const repGradings = [
        [{ id: 'a1', check: 'test1', pass: true, evidence: 'ok' }],
        [{ id: 'a1', check: 'test1', pass: false, evidence: 'no' }],
      ];

      averageResults(repGradings);

      expect(warn).not.toHaveBeenCalled();
      warn.mockRestore();
    });
  });

  describe('compact/verbose output', () => {
    it('produces compact output for passing checks', async () => {
      const { averageResults } = await import('../src/output.js');

      const repGradings = [[{ id: 'a1', check: 'test passes', pass: true, evidence: 'ok' }]];

      const result = averageResults(repGradings);

      expect(result.checks[0]).toEqual({
        check: 'test passes',
        pass_rate: 1.0,
      });
      expect(result.checks[0]).not.toHaveProperty('failures');
    });

    it('produces verbose output for failing checks with per-rep evidence', async () => {
      const { averageResults } = await import('../src/output.js');

      const repGradings = [
        [{ id: 'a1', check: 'test', pass: true, evidence: 'ok' }],
        [{ id: 'a1', check: 'test', pass: false, evidence: 'missing X' }],
      ];

      const result = averageResults(repGradings);

      expect(result.checks[0].pass_rate).toBe(0.5);
      expect(result.checks[0].failures).toEqual([{ rep: 2, evidence: 'missing X' }]);
    });

    it('attaches transcript to failure entries when repTranscripts provided', async () => {
      const { averageResults } = await import('../src/output.js');

      const repGradings = [
        [{ id: 'a1', check: 'test', pass: true, evidence: 'ok' }],
        [{ id: 'a1', check: 'test', pass: false, evidence: 'missing X' }],
      ];
      const repTranscripts = ['session: one\n', 'session: two\n'];

      const result = averageResults(repGradings, repTranscripts);

      expect(result.checks[0].failures).toEqual([
        { rep: 2, evidence: 'missing X', transcript: 'session: two\n' },
      ]);
    });
  });

  describe('streamHeader', () => {
    it('writes artifact_dir and scenarios key', async () => {
      const { streamHeader } = await import('../src/output.js');

      streamHeader('/tmp/craboodle-run-abc');

      expect(written).toBe('artifact_dir: /tmp/craboodle-run-abc\nscenarios:\n');
    });
  });

  describe('streamScenarioYaml', () => {
    it('writes atomic YAML block for a scenario', async () => {
      const { streamScenarioYaml } = await import('../src/output.js');

      streamScenarioYaml({
        id: 'email-validator',
        checks: [{ check: 'test passes', pass_rate: 1.0 }],
        pass_rate: 1.0,
      });

      expect(written).toContain('- email-validator:');
      expect(written).not.toContain('- id: email-validator');
      expect(written).toContain('pass_rate: 1');
      expect(written).toContain('check: test passes');
    });

    it('includes errors when present', async () => {
      const { streamScenarioYaml } = await import('../src/output.js');

      streamScenarioYaml({
        id: 'test',
        checks: [{ check: 'test', pass_rate: 1.0 }],
        pass_rate: 1.0,
        errors: [{ rep: 3, stage: 'scuttlerun', error: 'timeout after 120s' }],
      });

      expect(written).toContain('timeout after 120s');
      expect(written).toContain('stage: scuttlerun');
    });

    it('includes cost fields when present', async () => {
      const { streamScenarioYaml } = await import('../src/output.js');

      streamScenarioYaml({
        id: 'test',
        checks: [{ check: 'test', pass_rate: 1.0 }],
        pass_rate: 1.0,
        cost_usd: 0.0294,
        agent_cost_usd: 0.0234,
        grading_cost_usd: 0.006,
      });

      expect(written).toContain('cost_usd: 0.0294');
      expect(written).toContain('agent_cost_usd: 0.0234');
      expect(written).toContain('grading_cost_usd: 0.006');
    });

    it('adds blank lines between check items', async () => {
      const { streamScenarioYaml } = await import('../src/output.js');

      streamScenarioYaml({
        id: 'test-scenario',
        checks: [
          { check: 'first check', pass_rate: 1.0 },
          { check: 'second check', pass_rate: 1.0 },
        ],
        pass_rate: 1.0,
      });

      expect(written).toMatch(/first check[\s\S]*?\n\n\s*- check: second check/);
    });

    it('adds blank lines between failure items', async () => {
      const { streamScenarioYaml } = await import('../src/output.js');

      streamScenarioYaml({
        id: 'test-scenario',
        checks: [
          {
            check: 'failing check',
            pass_rate: 0,
            failures: [
              { rep: 1, evidence: 'first failure' },
              { rep: 2, evidence: 'second failure' },
            ],
          },
        ],
        pass_rate: 0,
      });

      expect(written).toMatch(/rep: 1[\s\S]*?\n\n\s*- rep: 2/);
    });

    it('ends with blank line for inter-scenario spacing', async () => {
      const { streamScenarioYaml } = await import('../src/output.js');

      streamScenarioYaml({
        id: 'solo',
        checks: [{ check: 'test', pass_rate: 1.0 }],
        pass_rate: 1.0,
      });

      expect(written).toMatch(/\n\n$/);
    });

    it('adds blank line before summary fields', async () => {
      const { streamScenarioYaml } = await import('../src/output.js');

      streamScenarioYaml({
        id: 'test',
        checks: [{ check: 'test', pass_rate: 1.0 }],
        pass_rate: 1.0,
        cost_usd: 0.05,
      });

      // Blank line between checks and pass_rate
      expect(written).toMatch(/\n\n\s+pass_rate:/);
    });

    it('handles null pass_rate for all-failed scenarios', async () => {
      const { streamScenarioYaml } = await import('../src/output.js');

      streamScenarioYaml({
        id: 'broken',
        checks: [{ check: 'test', pass_rate: 0 }],
        pass_rate: null,
        errors: [
          { rep: 1, stage: 'scuttlerun', error: 'crash' },
          { rep: 2, stage: 'scuttlerun', error: 'crash' },
        ],
      });

      expect(written).toContain('pass_rate: null');
    });
  });

  describe('parseLintResult', () => {
    it('parses pincenez lint YAML output', async () => {
      const { parseLintResult } = await import('../src/output.js');

      const yaml = `checks:
  - id: check-0
    check: "Output contains a validation function"
    issues: []
  - id: check-1
    check: "Handles edge cases"
    issues:
      - anti_pattern: compound
        suggestion: split into one assertion per check
      - anti_pattern: vague
        suggestion: name the specific edge case
checks_total: 2
checks_with_issues: 1
`;

      const result = parseLintResult(yaml);

      expect(result).toHaveLength(2);
      expect(result[0]).toEqual({
        id: 'check-0',
        check: 'Output contains a validation function',
        issues: [],
      });
      expect(result[1]).toEqual({
        id: 'check-1',
        check: 'Handles edge cases',
        issues: [
          { anti_pattern: 'compound', suggestion: 'split into one assertion per check' },
          { anti_pattern: 'vague', suggestion: 'name the specific edge case' },
        ],
      });
    });

    it('handles checks with no issues field', async () => {
      const { parseLintResult } = await import('../src/output.js');

      const yaml = `checks:
  - id: check-0
    check: "test"
checks_total: 1
checks_with_issues: 0
`;

      const result = parseLintResult(yaml);
      expect(result[0].issues).toEqual([]);
    });
  });

  describe('streamTotalCost', () => {
    it('writes total_cost_usd to stdout', async () => {
      const { streamTotalCost } = await import('../src/output.js');

      streamTotalCost(0.0456);

      expect(written).toContain('total_cost_usd: 0.0456');
    });

    it('rounds to 4 decimal places', async () => {
      const { streamTotalCost } = await import('../src/output.js');

      streamTotalCost(0.12345678);

      expect(written).toContain('total_cost_usd: 0.1235');
    });
  });

  describe('streamLintScenarioYaml', () => {
    it('emits nothing when all checks pass (no issues)', async () => {
      const { streamLintScenarioYaml } = await import('../src/output.js');

      streamLintScenarioYaml({
        id: 'all-clean',
        checks: [
          { id: 'check-0', check: 'first', issues: [] },
          { id: 'check-1', check: 'second', issues: [] },
        ],
        checks_total: 2,
        checks_with_issues: 0,
      });

      expect(written).toBe('');
    });

    it('uses id-as-key format for scenarios and checks', async () => {
      const { streamLintScenarioYaml } = await import('../src/output.js');

      streamLintScenarioYaml({
        id: 'email-validator',
        checks: [
          { id: 'check-0', check: 'validates email', issues: [] },
          {
            id: 'check-1',
            check: 'handles edge cases',
            issues: [{ anti_pattern: 'compound', suggestion: 'split it' }],
          },
        ],
        checks_total: 2,
        checks_with_issues: 1,
      });

      // Scenario id is the key, not a field
      expect(written).toContain('- email-validator:');
      expect(written).not.toContain('- id: email-validator');
      // Only checks with issues are emitted; clean checks are filtered
      expect(written).not.toContain('- check-0:');
      expect(written).toContain('- check-1:');
      expect(written).not.toMatch(/- id: check-/);
      // Counts still present (reflect originally-discovered, not emitted)
      expect(written).toContain('checks_total: 2');
      expect(written).toContain('checks_with_issues: 1');
      // Issue content preserved
      expect(written).toContain('anti_pattern: compound');
    });

    it('adds blank lines between check items', async () => {
      const { streamLintScenarioYaml } = await import('../src/output.js');

      streamLintScenarioYaml({
        id: 'test-scenario',
        checks: [
          {
            id: 'check-a',
            check: 'first check',
            issues: [{ anti_pattern: 'vague', suggestion: 'be specific' }],
          },
          {
            id: 'check-b',
            check: 'second check',
            issues: [{ anti_pattern: 'vague', suggestion: 'be specific' }],
          },
        ],
        checks_total: 2,
        checks_with_issues: 2,
      });

      // There should be a blank line between check items
      expect(written).toMatch(/check-a:[\s\S]*?\n\n\s*- check-b:/);
    });

    it('wraps long suggestion strings at 80 chars and uses block literal', async () => {
      const { streamLintScenarioYaml } = await import('../src/output.js');

      // 100 chars, no newlines — must be wrapped
      const longSuggestion = 'word '.repeat(20).trim();

      streamLintScenarioYaml({
        id: 'sc',
        checks: [
          {
            id: 'ch',
            check: 'test',
            issues: [{ anti_pattern: 'vague', suggestion: longSuggestion }],
          },
        ],
        checks_total: 1,
        checks_with_issues: 1,
      });

      // Wrapped into block literal (multiple lines)
      expect(written).toMatch(/suggestion: [|>]-?\n/);
      // The suggestion content must span multiple lines (was wrapped)
      const suggestionStart = written.indexOf('suggestion:');
      const afterSuggestion = written.slice(suggestionStart);
      const blockLines = afterSuggestion.split('\n').slice(1); // skip "suggestion: |"
      const contentLines: string[] = [];
      for (const line of blockLines) {
        if (line.match(/^\s+\w/)) contentLines.push(line.replace(/^\s+/, ''));
        else break;
      }
      expect(contentLines.length).toBeGreaterThan(1);
      for (const cl of contentLines) {
        expect(cl.length).toBeLessThanOrEqual(80);
      }
    });

    it('ends with blank line for inter-scenario spacing', async () => {
      const { streamLintScenarioYaml } = await import('../src/output.js');

      streamLintScenarioYaml({
        id: 'solo',
        checks: [
          {
            id: 'c',
            check: 'test',
            issues: [{ anti_pattern: 'vague', suggestion: 'be specific' }],
          },
        ],
        checks_total: 1,
        checks_with_issues: 1,
      });

      expect(written).toMatch(/\n\n$/);
    });
  });

  describe('streamLintTotals', () => {
    it('writes aggregate lint totals with blank line between groups', async () => {
      const { streamLintTotals } = await import('../src/output.js');

      streamLintTotals({
        scenarios_total: 3,
        scenarios_with_issues: 1,
        checks_total: 10,
        checks_with_issues: 2,
      });

      expect(written).toContain('scenarios_total: 3');
      expect(written).toContain('scenarios_with_issues: 1');
      expect(written).toContain('checks_total: 10');
      expect(written).toContain('checks_with_issues: 2');
      // Blank line separates scenario totals from check totals
      expect(written).toMatch(/scenarios_with_issues: 1\n\nchecks_total: 10/);
    });
  });

  describe('streamPluginCoverage', () => {
    it('writes a plugin_coverage block with skills, agents, commands and singletons', async () => {
      const { streamPluginCoverage } = await import('../src/output.js');

      streamPluginCoverage({
        skills: { bar: 0, foo: 2 },
        agents: { reviewer: 1 },
        commands: {},
        hooks: 0,
        mcp_servers: 3,
      });

      expect(written).toContain('plugin_coverage:');
      expect(written).toMatch(/skills:\n {4}bar: 0\n {4}foo: 2/);
      expect(written).toMatch(/agents:\n {4}reviewer: 1/);
      expect(written).toMatch(/commands: \{\}/);
      expect(written).toMatch(/^ {2}hooks: 0/m);
      expect(written).toMatch(/^ {2}mcp_servers: 3/m);
    });
  });

  describe('writeYamlArrayItem', () => {
    it('serializes an object as a YAML list item with proper indentation', async () => {
      const { writeYamlArrayItem } = await import('../src/output.js');

      const result = writeYamlArrayItem({ id: 'test', count: 3 });

      expect(result).toBe('  - id: test\n    count: 3');
    });

    it('uses block literal style for multiline strings', async () => {
      const { writeYamlArrayItem } = await import('../src/output.js');

      const result = writeYamlArrayItem({ id: 'test', message: 'line one\nline two\n' });

      expect(result).toContain('message: |\n');
      expect(result).toContain('      line one\n');
      expect(result).toContain('      line two');
    });

    it('handles nested objects', async () => {
      const { writeYamlArrayItem } = await import('../src/output.js');

      const result = writeYamlArrayItem({ id: 'test', metadata: { env: 'prod' } });

      expect(result).toContain('  - id: test');
      expect(result).toContain('    metadata:');
      expect(result).toContain('      env: prod');
    });

    it('wraps long strings at 80 chars and uses block literal', async () => {
      const { writeYamlArrayItem } = await import('../src/output.js');

      const long = 'word '.repeat(20).trim(); // 99 chars
      const result = writeYamlArrayItem({ id: 'test', message: long });

      // Wrapped into block literal
      expect(result).toMatch(/message: [|>]/);
      // Each content line within 80 chars
      const lines = result.split('\n');
      for (const line of lines) {
        const content = line.replace(/^\s+/, '');
        if (content.length > 0 && !content.startsWith('-') && !content.includes(':')) {
          expect(content.length).toBeLessThanOrEqual(80);
        }
      }
    });

    it('does not wrap short strings', async () => {
      const { writeYamlArrayItem } = await import('../src/output.js');

      const result = writeYamlArrayItem({ id: 'test', note: 'short value' });

      expect(result).not.toMatch(/note: [|>]/);
      expect(result).toContain('note: short value');
    });

    it('wraps long string ending in trailing whitespace without emitting blank lines', async () => {
      const { writeYamlArrayItem } = await import('../src/output.js');

      const value = 'a'.repeat(80) + '  ';
      const result = writeYamlArrayItem({ msg: value });

      expect(result).toContain('a'.repeat(80));
      // No internal blank line in the serialized item
      expect(result).not.toMatch(/\n[ \t]*\n/);
    });

    it('renders long single-line strings as block-folded (`>`), not block-literal', async () => {
      const { writeYamlArrayItem } = await import('../src/output.js');

      const text = 'a long single-line string '.repeat(8).trim();
      const result = writeYamlArrayItem({ evidence: text });

      expect(result).toMatch(/evidence: >-?\n/);
      expect(result).not.toMatch(/evidence: \|-?\n/);
    });

    it('hard-wraps long lines inside multi-line strings before block-literal serialization', async () => {
      const { parse } = await import('yaml');
      const { writeYamlArrayItem } = await import('../src/output.js');

      const longInternal =
        'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega extra padding words here';
      const result = writeYamlArrayItem({
        evidence: `First line\n${longInternal}\nLast line`,
      });

      const longest = Math.max(...result.split('\n').map((l) => l.length));
      expect(longest).toBeLessThanOrEqual(80);

      const parsed = parse('items:\n' + result + '\n') as { items: Array<{ evidence: string }> };
      expect(parsed.items[0].evidence).toContain('First line');
      expect(parsed.items[0].evidence).toContain('Last line');
      for (const line of parsed.items[0].evidence.split('\n')) {
        expect(line.length).toBeLessThanOrEqual(72);
      }
    });

    it('leaves unbreakable strings (no whitespace) verbatim', async () => {
      const { parse } = await import('yaml');
      const { writeYamlArrayItem } = await import('../src/output.js');

      const blob = 'b'.repeat(200);
      const result = writeYamlArrayItem({ evidence: blob });

      const parsed = parse('items:\n' + result + '\n') as { items: Array<{ evidence: string }> };
      expect(parsed.items[0].evidence).toBe(blob);
    });
  });

  describe('streamScenarioYaml multiline', () => {
    it('uses block literal style for multiline error strings', async () => {
      const { streamScenarioYaml } = await import('../src/output.js');

      streamScenarioYaml({
        id: 'test',
        checks: [{ check: 'test', pass_rate: 0 }],
        pass_rate: null,
        errors: [{ rep: 1, stage: 'scuttlerun', error: 'line one\nline two\n' }],
      });

      expect(written).toContain('error: |\n');
    });

    it('keeps every line at or below 80 columns even at deepest nesting', async () => {
      const { streamScenarioYaml } = await import('../src/output.js');

      // Mirrors the haiku-writer output shape: scenario → checks → failures →
      // evidence (multi-line) + transcript (single-line path).
      streamScenarioYaml({
        id: 'topic-not-provided',
        checks: [
          {
            check: 'The haiku has exactly 3 lines following a 5-7-5 syllable pattern',
            pass_rate: 1,
          },
          {
            check: 'The agent asked the user what topic they wanted before composing the haiku',
            pass_rate: 0,
            failures: [
              {
                rep: 1,
                evidence:
                  'The agent did not ask the user for a topic before composing the haiku. It received the request "I want a haiku. Save it to a file when you\'re done." and immediately responded with a haiku about "Silent code compiles" without asking what topic the user wanted, violating the haiku-writer skill\'s requirement to ask for a topic first.',
                transcript: 'topic-not-provided/rep-1/output.yaml',
              },
            ],
          },
        ],
        pass_rate: 0.5,
        cost_usd: 0.3904,
      });

      const lines = written.split('\n');
      for (const line of lines) {
        expect(line.length, `line over 80 cols: ${JSON.stringify(line)}`).toBeLessThanOrEqual(80);
      }
    });

    it('renders transcript paths as relative when artifactDir provided', async () => {
      const { streamScenarioYaml } = await import('../src/output.js');

      streamScenarioYaml(
        {
          id: 'scenario-a',
          checks: [
            {
              check: 'always fails',
              pass_rate: 0,
              failures: [
                {
                  rep: 1,
                  evidence: 'failed',
                  transcript: '/tmp/craboodle-run-abc/scenario-a/rep-1/output.yaml',
                },
              ],
            },
          ],
          pass_rate: 0,
          errors: [
            {
              rep: 1,
              stage: 'pincenez',
              error: 'boom',
              transcript: '/tmp/craboodle-run-abc/scenario-a/rep-1/grading.yaml',
            },
          ],
        },
        { artifactDir: '/tmp/craboodle-run-abc' },
      );

      expect(written).toContain('transcript: scenario-a/rep-1/output.yaml');
      expect(written).toContain('transcript: scenario-a/rep-1/grading.yaml');
      expect(written).not.toContain('/tmp/craboodle-run-abc/scenario-a');
    });
  });

  describe('full YAML integration', () => {
    it('produces valid YAML when header + scenarios are combined', async () => {
      const { parse } = await import('yaml');
      const { streamHeader, streamScenarioYaml } = await import('../src/output.js');

      streamHeader('/tmp/craboodle-run-abc');
      streamScenarioYaml({
        id: 'scenario-a',
        checks: [
          { check: 'passes', pass_rate: 1.0 },
          {
            check: 'sometimes fails',
            pass_rate: 0.67,
            failures: [{ rep: 2, evidence: 'not found' }],
          },
        ],
        pass_rate: 0.83,
      });
      streamScenarioYaml({
        id: 'scenario-b',
        checks: [{ check: 'always passes', pass_rate: 1.0 }],
        pass_rate: 1.0,
      });

      const parsed = parse(written);
      expect(parsed.artifact_dir).toBe('/tmp/craboodle-run-abc');
      expect(parsed.scenarios).toHaveLength(2);
      expect(Object.keys(parsed.scenarios[0])[0]).toBe('scenario-a');
      expect(parsed.scenarios[0]['scenario-a'].pass_rate).toBe(0.83);
      expect(Object.keys(parsed.scenarios[1])[0]).toBe('scenario-b');
      expect(parsed.scenarios[1]['scenario-b'].pass_rate).toBe(1.0);
    });
  });
});
