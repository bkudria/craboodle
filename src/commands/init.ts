import { access, mkdir, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { formatErrorWithHint } from '../errors.js';
import { EXIT_CONFIG_ERROR } from '../exit-codes.js';
import {
  enumeratePluginComponents,
  loadPluginManifest,
  type PluginComponents,
  type PluginManifest,
} from '../plugin.js';

type PlaceholderComponentType = 'skill' | 'agent' | 'command' | 'hooks' | 'mcp_servers';

function renderPlaceholderScenario(
  componentType: PlaceholderComponentType,
  componentId: string,
): { scenarioYaml: string; checksYaml: string } {
  if (componentType === 'skill') {
    return {
      scenarioYaml:
        `# TODO: replace with a prompt that should trigger the \`${componentId}\` skill.\n` +
        `# The prompt should NOT name the skill — let the agent decide whether to load it.\n` +
        `prompt: |\n` +
        `  TODO: describe the user's request here.\n` +
        `\n` +
        `# user:\n` +
        `#   max_turns: 4\n`,
      checksYaml:
        `# Placeholder checks for the \`${componentId}\` skill. Uncomment and edit.\n` +
        `# Skill calls surface in the transcript as \`tool: Skill\` entries with \`skill: <id>\`.\n` +
        `checks: []\n` +
        `# checks:\n` +
        `#   - ${componentId}-skill-triggered:\n` +
        `#       check: 'A \`tool: Skill\` entry with \`skill: ${componentId}\` appears in the transcript'\n` +
        `#       note: 'Plugin-component check: verifies the skill loaded for this prompt'\n`,
    };
  }
  if (componentType === 'mcp_servers') {
    return {
      scenarioYaml:
        `# TODO: replace with a prompt that should cause the agent to call one of the plugin's\n` +
        `# MCP-server tools. The plugin's .mcp.json declares the server(s); each exposed tool\n` +
        `# is callable as \`mcp__<server>__<tool>\`.\n` +
        `prompt: |\n` +
        `  TODO: describe a user request that requires the MCP server's capability.\n` +
        `\n` +
        `# user:\n` +
        `#   max_turns: 4\n`,
      checksYaml:
        `# Placeholder checks for MCP-server tools. Uncomment and edit.\n` +
        `# MCP-tool calls surface in the transcript as \`tool: mcp__<server>__<tool>\` entries.\n` +
        `checks: []\n` +
        `# checks:\n` +
        `#   - mcp-tool-called:\n` +
        `#       check: 'A \`tool: mcp__<server>__<tool>\` entry appears in the transcript (replace <server> and <tool> with the specific id)'\n` +
        `#       note: 'Plugin-component check: verifies an MCP-server tool was invoked'\n`,
    };
  }
  if (componentType === 'hooks') {
    return {
      scenarioYaml:
        `# TODO: replace with a prompt that exercises the plugin's hooks/hooks.json behaviour.\n` +
        `# Hooks have no per-id enumeration today; use this single placeholder regardless of\n` +
        `# how many hooks the plugin declares.\n` +
        `prompt: |\n` +
        `  TODO: describe a user request whose handling the hooks should observe or alter.\n` +
        `\n` +
        `# user:\n` +
        `#   max_turns: 4\n`,
      checksYaml:
        `# Placeholder checks for hooks. Uncomment and edit.\n` +
        `# Hooks are observed via their side effects on the transcript and the project tree:\n` +
        `#   - a tool call that would otherwise have happened is blocked (PreToolUse deny)\n` +
        `#   - a tool call's input was mutated before execution\n` +
        `#   - a file the hook owns was written / updated\n` +
        `# There is no direct \`tool: hook\` entry — assert against the observable result.\n` +
        `checks: []\n` +
        `# checks:\n` +
        `#   - hook-side-effect-observed:\n` +
        `#       check: 'TODO: describe the observable side effect the hook should produce'\n` +
        `#       note: 'Plugin-component check: hooks are observed by their side effects, not direct tool calls'\n`,
    };
  }
  if (componentType === 'command') {
    return {
      scenarioYaml:
        `# TODO: replace with a prompt that invokes the \`/${componentId}\` slash command.\n` +
        `# Slash commands surface in the prompt stream as a user message starting with /<id>;\n` +
        `# they are not tool: entries.\n` +
        `prompt: |\n` +
        `  /${componentId} TODO: arguments here, if any.\n` +
        `\n` +
        `# user:\n` +
        `#   max_turns: 4\n`,
      checksYaml:
        `# Placeholder checks for the \`/${componentId}\` slash command. Uncomment and edit.\n` +
        `# Commands are observed via their effects (the agent's response, files written, tools called).\n` +
        `checks: []\n` +
        `# checks:\n` +
        `#   - ${componentId}-command-invoked:\n` +
        `#       check: 'The transcript contains a user message that begins with \`/${componentId}\`'\n` +
        `#       note: 'Plugin-component check: verifies the slash command was sent through the prompt stream'\n`,
    };
  }
  if (componentType === 'agent') {
    return {
      scenarioYaml:
        `# TODO: replace with a prompt that should cause the agent to dispatch the \`${componentId}\` sub-agent.\n` +
        `# The prompt should NOT name the sub-agent — let the agent decide.\n` +
        `prompt: |\n` +
        `  TODO: describe the user's request here.\n` +
        `\n` +
        `# user:\n` +
        `#   max_turns: 4\n`,
      checksYaml:
        `# Placeholder checks for the \`${componentId}\` sub-agent. Uncomment and edit.\n` +
        `# Sub-agent dispatches surface in the transcript as \`tool: Agent\` entries with \`subagent_type: <id>\`.\n` +
        `# Tools used inside the sub-agent's sub-session are NOT visible in the outer transcript.\n` +
        `checks: []\n` +
        `# checks:\n` +
        `#   - ${componentId}-dispatched:\n` +
        `#       check: 'A \`tool: Agent\` entry with \`subagent_type: ${componentId}\` appears in the transcript'\n` +
        `#       note: 'Plugin-component check: verifies the sub-agent was dispatched for this prompt'\n`,
    };
  }
  // Other component types are added in later changes.
  throw new Error(`Unsupported placeholder component type: ${componentType}`);
}

function renderCompositionPlaceholder(): { scenarioYaml: string; checksYaml: string } {
  return {
    scenarioYaml:
      `# TODO: replace with a prompt that exercises TWO OR MORE of this plugin's\n` +
      `# components together in one session — the composition the plugin adds over\n` +
      `# its components in isolation. Single-component scenarios belong in the\n` +
      `# per-component placeholders scaffolded alongside this one.\n` +
      `prompt: |\n` +
      `  TODO: describe a user request that should make two or more components work together.\n` +
      `\n` +
      `# user:\n` +
      `#   max_turns: 8\n`,
    checksYaml:
      `# Placeholder checks for a composition (bundle) scenario. Uncomment and edit.\n` +
      `# A composition scenario must keep at least one cross-component check — one that\n` +
      `# asserts two or more components interacting in the same session, not a single\n` +
      `# component in isolation.\n` +
      `checks: []\n` +
      `# checks:\n` +
      `#   - cross-component-interaction:\n` +
      `#       check: 'TODO: assert two components interacting in one session — e.g. a \`tool: Skill\` entry with \`skill: <skill-id>\` AND a later \`tool: Agent\` entry with \`subagent_type: <agent-id>\`'\n` +
      `#       note: 'Composition check: at least one check must assert a cross-component interaction'\n`,
  };
}

export function placeholderDirName(componentType: PlaceholderComponentType, id: string): string {
  // Named components get a `<type>-` prefix so the coverage matcher (which
  // requires `<type>-<id>` or `<type>-<id>-*` for skills/agents/commands)
  // accepts the freshly scaffolded scenario. Hooks and mcp-servers use the
  // singleton matcher form (`<type>-*`) where id is already the literal
  // type name, so the existing `<id>-placeholder` already matches.
  if (componentType === 'skill' || componentType === 'agent' || componentType === 'command') {
    return `${componentType}-${id}-placeholder`;
  }
  return `${id}-placeholder`;
}

async function writePlaceholderScenarios(
  rootDir: string,
  components: PluginComponents,
): Promise<string[]> {
  const written: string[] = [];

  async function writeOne(componentType: PlaceholderComponentType, id: string): Promise<void> {
    const dirName = placeholderDirName(componentType, id);
    const dir = join(rootDir, 'evals', dirName);
    await mkdir(dir, { recursive: true });
    const rendered = renderPlaceholderScenario(componentType, id);
    await writeFile(join(dir, 'scenario.yaml'), rendered.scenarioYaml);
    await writeFile(join(dir, 'checks.yaml'), rendered.checksYaml);
    written.push(`evals/${dirName}/scenario.yaml`);
    written.push(`evals/${dirName}/checks.yaml`);
  }

  for (const skillId of components.skills) {
    await writeOne('skill', skillId);
  }
  for (const agentId of components.agents) {
    await writeOne('agent', agentId);
  }
  for (const commandId of components.commands) {
    await writeOne('command', commandId);
  }
  if (components.hasHooks) {
    await writeOne('hooks', 'hooks');
  }
  if (components.hasMcpServers) {
    await writeOne('mcp_servers', 'mcp-servers');
  }

  // A composition (bundle) scenario exercises two or more components together,
  // so it only makes sense when the plugin actually has multiple components.
  const componentTotal =
    components.skills.length +
    components.agents.length +
    components.commands.length +
    (components.hasHooks ? 1 : 0) +
    (components.hasMcpServers ? 1 : 0);
  if (componentTotal >= 2) {
    const dir = join(rootDir, 'evals', 'composition-placeholder');
    await mkdir(dir, { recursive: true });
    const rendered = renderCompositionPlaceholder();
    await writeFile(join(dir, 'scenario.yaml'), rendered.scenarioYaml);
    await writeFile(join(dir, 'checks.yaml'), rendered.checksYaml);
    written.push('evals/composition-placeholder/scenario.yaml');
    written.push('evals/composition-placeholder/checks.yaml');
  }

  return written;
}

async function detectInitMode(root: string): Promise<{ mode: 'skill' | 'plugin' | 'generic' }> {
  const hasPluginMarker = await access(join(root, '.claude-plugin', 'plugin.json')).then(
    () => true,
    () => false,
  );
  if (hasPluginMarker) return { mode: 'plugin' };
  const hasSkillMd = await access(join(root, 'SKILL.md')).then(
    () => true,
    () => false,
  );
  if (hasSkillMd) return { mode: 'skill' };
  return { mode: 'generic' };
}

async function tryLoadPluginManifest(root: string): Promise<PluginManifest | undefined> {
  try {
    return await loadPluginManifest(root);
  } catch {
    return undefined;
  }
}

function renderEvalsYaml(mode: 'skill' | 'plugin' | 'generic'): string {
  let projectBlock: string;
  if (mode === 'skill') {
    projectBlock = `    #   skills:\n    #     - .                            # self-reference: this skill\n`;
  } else if (mode === 'plugin') {
    projectBlock = `    #   plugins:\n    #     - .                            # self-reference: this plugin\n`;
  } else {
    projectBlock = `    #   skills:\n    #     - /absolute/path/to/skill\n`;
  }

  return (
    `version: "1"\n` +
    `# min_pass_rate:      # default: unset (no gating); reachable values are k/(checks*reps)\n` +
    `# max_budget_usd:     # default: unset (no cap)\n` +
    `# repeats: 3          # default: 3\n` +
    `# artifact_retention_days: 7   # default: 7 (0 disables cleanup)\n` +
    `\n` +
    `scenarios:\n` +
    `  # path: evals       # default: "evals" — single dir name, no slashes\n` +
    `  base:\n` +
    `    # Shared scuttlerun config applied to every scenario in this suite.\n` +
    `    # To ADD tools to scuttlerun's defaults, use \`additional_tools:\` — it is appended\n` +
    `    # and deduped. To REPLACE the defaults entirely, use \`tools:\` (arrays replace).\n` +
    `    #\n` +
    `    # model: claude-haiku-4-5\n` +
    `    # additional_tools:\n` +
    `    #   - TodoWrite\n` +
    `    # project:\n` +
    `    #   claude_md: |\n` +
    `    #     # Project-level instructions here\n` +
    projectBlock +
    `    # user:\n` +
    `    #   max_turns: 30\n`
  );
}

export async function initCommand(dir: string): Promise<void> {
  const resolvedDir = resolve(dir);

  try {
    await access(join(resolvedDir, 'evals.yaml'));
    process.stderr.write(
      formatErrorWithHint(
        `${resolvedDir} already contains evals.yaml`,
        'pick a different directory or remove the existing file(s)',
      ),
    );
    process.exit(EXIT_CONFIG_ERROR);
  } catch {
    // evals.yaml doesn't exist, good
  }

  try {
    const dirStat = await stat(resolvedDir);
    if (dirStat.isDirectory()) {
      const { glob: globFn } = await import('glob');
      const existing = await globFn('evals/*/scenario.{yaml,yml}', { cwd: resolvedDir });
      if (existing.length > 0) {
        process.stderr.write(
          formatErrorWithHint(
            `${resolvedDir} already contains scenario files`,
            'pick a different directory or remove the existing file(s)',
          ),
        );
        process.exit(EXIT_CONFIG_ERROR);
      }
    }
  } catch {
    // directory doesn't exist, we'll create it
  }

  await mkdir(resolvedDir, { recursive: true });

  const { mode } = await detectInitMode(resolvedDir);
  await writeFile(join(resolvedDir, 'evals.yaml'), renderEvalsYaml(mode));

  let placeholderPaths: string[] = [];
  if (mode === 'plugin') {
    const components = await enumeratePluginComponents(resolvedDir);
    placeholderPaths = await writePlaceholderScenarios(resolvedDir, components);
  }

  process.stdout.write(`Created ${resolvedDir}/\n`);
  process.stdout.write(`  evals.yaml\n`);
  for (const relPath of placeholderPaths) {
    process.stdout.write(`  ${relPath}\n`);
  }

  if (mode === 'plugin') {
    const manifest = await tryLoadPluginManifest(resolvedDir);
    if (manifest) {
      const versionSuffix = manifest.version ? ` (${manifest.version})` : '';
      process.stdout.write(`\nDetected plugin: ${manifest.name}${versionSuffix}\n`);
    }
  }

  process.stdout.write(`\nNext steps:\n`);
  if (placeholderPaths.some((p) => p.includes('composition-placeholder'))) {
    process.stdout.write(
      `  Turn evals/composition-placeholder/ into a real composition scenario (exercises two or more components; keep at least one cross-component check)\n`,
    );
  }
  process.stdout.write(`  Create evals/<scenario-id>/scenario.yaml and checks.yaml\n`);
  process.stdout.write(`  craboodle list ${dir}     # validate scenarios\n`);
  process.stdout.write(`  craboodle lint ${dir}     # check quality\n`);
  process.stdout.write(`  craboodle run ${dir}      # run eval pipeline\n`);
}
