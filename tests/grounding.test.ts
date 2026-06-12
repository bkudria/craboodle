import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('../src/runner.js', () => ({
  listScuttlerunConfig: vi.fn(),
}));

import { listScuttlerunConfig } from '../src/runner.js';
import { resolveScenarioGrounding } from '../src/grounding.js';

const mockListConfig = vi.mocked(listScuttlerunConfig);

describe('resolveScenarioGrounding', () => {
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

    const grounding = await resolveScenarioGrounding(
      'my-scenario',
      '/root/evals/my-scenario/scenario.yaml',
      '/staged/.craboodle-base.yaml',
      'lint',
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

  it('returns prompt-only grounding when the summary has no tools', async () => {
    mockListConfig.mockResolvedValue({
      success: true,
      stdout: 'prompt: Write a haiku\n',
    });

    const grounding = await resolveScenarioGrounding(
      'my-scenario',
      '/root/evals/my-scenario/scenario.yaml',
      '/staged/.craboodle-base.yaml',
      'lint',
    );

    expect(grounding).toEqual({ context: 'Write a haiku' });
    expect(stderrSpy).not.toHaveBeenCalled();
  });

  it('warns and returns empty grounding when dry-run fails', async () => {
    mockListConfig.mockResolvedValue({
      success: false,
      error: { stage: 'scuttlerun', message: 'invalid config' },
    });

    const grounding = await resolveScenarioGrounding(
      'my-scenario',
      '/root/evals/my-scenario/scenario.yaml',
      '/staged/.craboodle-base.yaml',
      'lint',
    );

    expect(grounding).toEqual({});
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('my-scenario: could not resolve scenario config'),
    );
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('lint grounding degraded'));
  });

  it('warns about degraded tautology detection when the summary has no prompt', async () => {
    mockListConfig.mockResolvedValue({
      success: true,
      stdout: 'tools:\n  - Read\n',
    });

    const grounding = await resolveScenarioGrounding(
      'my-scenario',
      '/root/evals/my-scenario/scenario.yaml',
      '/staged/.craboodle-base.yaml',
      'lint',
    );

    expect(grounding).toEqual({ availableTools: ['Read'] });
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('my-scenario: scenario has no prompt; tautology detection degraded'),
    );
  });

  it('words the dry-run failure warning for grading when grounding grading', async () => {
    mockListConfig.mockResolvedValue({
      success: false,
      error: { stage: 'scuttlerun', message: 'invalid config' },
    });

    const grounding = await resolveScenarioGrounding(
      'my-scenario',
      '/root/evals/my-scenario/scenario.yaml',
      '/staged/.craboodle-base.yaml',
      'grading',
    );

    expect(grounding).toEqual({});
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('my-scenario: could not resolve scenario config'),
    );
    expect(stderrSpy).toHaveBeenCalledWith(expect.stringContaining('grading grounding degraded'));
  });

  it('words the missing-prompt warning for grading when grounding grading', async () => {
    mockListConfig.mockResolvedValue({
      success: true,
      stdout: 'tools:\n  - Read\n',
    });

    const grounding = await resolveScenarioGrounding(
      'my-scenario',
      '/root/evals/my-scenario/scenario.yaml',
      '/staged/.craboodle-base.yaml',
      'grading',
    );

    expect(grounding).toEqual({ availableTools: ['Read'] });
    expect(stderrSpy).toHaveBeenCalledWith(
      expect.stringContaining('my-scenario: scenario has no prompt; grading context degraded'),
    );
  });
});
