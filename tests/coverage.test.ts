import { describe, it, expect } from 'vitest';

describe('computePluginCoverage', () => {
  it('returns zeros for empty components', async () => {
    const { computePluginCoverage } = await import('../src/coverage.js');
    const coverage = computePluginCoverage([], {
      skills: [],
      agents: [],
      commands: [],
      hasHooks: false,
      hasMcpServers: false,
    });
    expect(coverage).toEqual({
      skills: {},
      agents: {},
      commands: {},
      hooks: 0,
      mcp_servers: 0,
    });
  });

  it('counts a matching skill scenario via prefix form', async () => {
    const { computePluginCoverage } = await import('../src/coverage.js');
    const coverage = computePluginCoverage(['skill-foo-basic'], {
      skills: ['foo'],
      agents: [],
      commands: [],
      hasHooks: false,
      hasMcpServers: false,
    });
    expect(coverage.skills).toEqual({ foo: 1 });
  });

  it('counts a skill scenario in exact-match form', async () => {
    const { computePluginCoverage } = await import('../src/coverage.js');
    const coverage = computePluginCoverage(['skill-foo'], {
      skills: ['foo'],
      agents: [],
      commands: [],
      hasHooks: false,
      hasMcpServers: false,
    });
    expect(coverage.skills).toEqual({ foo: 1 });
  });

  it('does not count scenarios that share a substring but not the prefix shape', async () => {
    const { computePluginCoverage } = await import('../src/coverage.js');
    const coverage = computePluginCoverage(
      ['skillfoo', 'skill-foobar', 'random-skill-foo', 'skill_foo'],
      {
        skills: ['foo'],
        agents: [],
        commands: [],
        hasHooks: false,
        hasMcpServers: false,
      },
    );
    expect(coverage.skills).toEqual({ foo: 0 });
  });

  it('zero-fills declared skills that have no matching scenarios', async () => {
    const { computePluginCoverage } = await import('../src/coverage.js');
    const coverage = computePluginCoverage(['skill-foo-basic'], {
      skills: ['foo', 'bar', 'baz'],
      agents: [],
      commands: [],
      hasHooks: false,
      hasMcpServers: false,
    });
    expect(coverage.skills).toEqual({ foo: 1, bar: 0, baz: 0 });
  });

  it('matches longest component id first when prefixes overlap', async () => {
    const { computePluginCoverage } = await import('../src/coverage.js');
    const coverage = computePluginCoverage(['skill-foo-bar', 'skill-foo-bar-extra'], {
      skills: ['foo', 'foo-bar'],
      agents: [],
      commands: [],
      hasHooks: false,
      hasMcpServers: false,
    });
    expect(coverage.skills).toEqual({ foo: 0, 'foo-bar': 2 });
  });

  it('counts matching agent scenarios with the agent prefix', async () => {
    const { computePluginCoverage } = await import('../src/coverage.js');
    const coverage = computePluginCoverage(['agent-reviewer-flow', 'agent-auditor'], {
      skills: [],
      agents: ['reviewer', 'auditor'],
      commands: [],
      hasHooks: false,
      hasMcpServers: false,
    });
    expect(coverage.agents).toEqual({ reviewer: 1, auditor: 1 });
  });

  it('counts matching command scenarios with the command prefix', async () => {
    const { computePluginCoverage } = await import('../src/coverage.js');
    const coverage = computePluginCoverage(['command-deploy-staging', 'command-build'], {
      skills: [],
      agents: [],
      commands: ['deploy', 'build', 'release'],
      hasHooks: false,
      hasMcpServers: false,
    });
    expect(coverage.commands).toEqual({ deploy: 1, build: 1, release: 0 });
  });

  it('counts hooks scenarios as the hooks singleton when hasHooks is true', async () => {
    const { computePluginCoverage } = await import('../src/coverage.js');
    const coverage = computePluginCoverage(['hooks', 'hooks-clean', 'skill-foo-basic', 'other'], {
      skills: ['foo'],
      agents: [],
      commands: [],
      hasHooks: true,
      hasMcpServers: false,
    });
    expect(coverage.hooks).toBe(2);
  });

  it('reports hooks = 0 when hasHooks is false even if hooks-prefixed scenarios exist', async () => {
    const { computePluginCoverage } = await import('../src/coverage.js');
    const coverage = computePluginCoverage(['hooks-clean'], {
      skills: [],
      agents: [],
      commands: [],
      hasHooks: false,
      hasMcpServers: false,
    });
    expect(coverage.hooks).toBe(0);
  });

  it('counts mcp scenarios as the mcp_servers singleton when hasMcpServers is true', async () => {
    const { computePluginCoverage } = await import('../src/coverage.js');
    const coverage = computePluginCoverage(['mcp', 'mcp-listing', 'unrelated'], {
      skills: [],
      agents: [],
      commands: [],
      hasHooks: false,
      hasMcpServers: true,
    });
    expect(coverage.mcp_servers).toBe(2);
  });

  it('reports mcp_servers = 0 when hasMcpServers is false even if mcp-prefixed scenarios exist', async () => {
    const { computePluginCoverage } = await import('../src/coverage.js');
    const coverage = computePluginCoverage(['mcp-x'], {
      skills: [],
      agents: [],
      commands: [],
      hasHooks: false,
      hasMcpServers: false,
    });
    expect(coverage.mcp_servers).toBe(0);
  });

  it('placeholder names from `craboodle init` cover every declared component', async () => {
    // Contract: the scenario directory names that init scaffolds must be
    // counted by the coverage matcher. If init renames placeholders without
    // updating the matcher (or vice versa), this test catches the drift.
    const { computePluginCoverage } = await import('../src/coverage.js');
    const { placeholderDirName } = await import('../src/commands/init.js');
    const components = {
      skills: ['take-notes'],
      agents: ['note-summarizer'],
      commands: ['triage'],
      hasHooks: true,
      hasMcpServers: true,
    };
    const initScenarioIds = [
      placeholderDirName('skill', 'take-notes'),
      placeholderDirName('agent', 'note-summarizer'),
      placeholderDirName('command', 'triage'),
      placeholderDirName('hooks', 'hooks'),
      placeholderDirName('mcp_servers', 'mcp-servers'),
    ];
    const coverage = computePluginCoverage(initScenarioIds, components);
    expect(coverage.skills).toEqual({ 'take-notes': 1 });
    expect(coverage.agents).toEqual({ 'note-summarizer': 1 });
    expect(coverage.commands).toEqual({ triage: 1 });
    expect(coverage.hooks).toBe(1);
    expect(coverage.mcp_servers).toBe(1);
  });
});
