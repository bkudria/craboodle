import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/runner.js', () => ({
  listScuttlerunConfig: vi.fn(),
  runPincenezLint: vi.fn(),
}));

import { listScuttlerunConfig } from '../src/runner.js';
import { resolveLintGrounding } from '../src/commands/lint.js';

const mockListConfig = vi.mocked(listScuttlerunConfig);

describe('resolveLintGrounding', () => {
  let stderrSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    stderrSpy = vi.spyOn(process.stderr, 'write').mockImplementation(() => true);
  });

  afterEach(() => {
    stderrSpy.mockRestore();
  });

  it('returns the resolved prompt and tools from scuttlerun dry-run', async () => {
    mockListConfig.mockResolvedValue({
      success: true,
      stdout: 'tools:\n  - Read\n  - TaskCreate\nprompt: Write a haiku\n',
    });

    const grounding = await resolveLintGrounding(
      'my-scenario',
      '/root/evals/my-scenario/scenario.yaml',
      '/staged/.craboodle-base.yaml',
    );

    expect(mockListConfig).toHaveBeenCalledWith(
      expect.objectContaining({
        scenarioPath: '/root/evals/my-scenario/scenario.yaml',
        basePath: '/staged/.craboodle-base.yaml',
      }),
    );
    expect(grounding).toEqual({
      context: 'Write a haiku',
      availableTools: ['Read', 'TaskCreate'],
    });
  });

  it('warns and returns empty grounding when dry-run fails', async () => {
    mockListConfig.mockResolvedValue({
      success: false,
      error: { stage: 'scuttlerun', message: 'invalid config' },
    });

    const grounding = await resolveLintGrounding(
      'my-scenario',
      '/root/evals/my-scenario/scenario.yaml',
      '/staged/.craboodle-base.yaml',
    );

    expect(grounding).toEqual({});
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('my-scenario: could not resolve scenario config'),
    );
  });

  it('warns about degraded tautology detection when the summary has no prompt', async () => {
    mockListConfig.mockResolvedValue({
      success: true,
      stdout: 'tools:\n  - Read\n',
    });

    const grounding = await resolveLintGrounding(
      'my-scenario',
      '/root/evals/my-scenario/scenario.yaml',
      '/staged/.craboodle-base.yaml',
    );

    expect(grounding).toEqual({ availableTools: ['Read'] });
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('my-scenario: scenario has no prompt; tautology detection degraded'),
    );
  });
});
