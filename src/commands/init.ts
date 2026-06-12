import { access, mkdir, readFile, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { parse } from 'yaml';
import { coversComponentKey, discoverScenarios } from '../discovery.js';
import {
  enumeratePluginComponents,
  loadPluginManifest,
  type PluginComponents,
  type PluginManifest,
} from '../plugin.js';

type PlaceholderComponentType = 'skill' | 'agent' | 'command' | 'hooks' | 'mcp_servers';

interface SkippedItem {
  label: string;
  reason: string;
}

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
        `# Skill calls surface in the transcript as \`tool: Skill\` entries with \`input.skill: <plugin>:<id>\` (the skill id is namespaced).\n` +
        `checks: []\n` +
        `# checks:\n` +
        `#   - ${componentId}-skill-triggered:\n` +
        `#       check: 'A \`tool: Skill\` entry with \`input.skill: <plugin>:${componentId}\` appears in the transcript'\n` +
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
        `# Sub-agent dispatches surface in the transcript as \`tool: Agent\` entries with \`input.subagent_type: <plugin>:<id>\` (the sub-agent id is namespaced).\n` +
        `# Tools used inside the sub-agent's sub-session are NOT visible in the outer transcript.\n` +
        `checks: []\n` +
        `# checks:\n` +
        `#   - ${componentId}-dispatched:\n` +
        `#       check: 'A \`tool: Agent\` entry with \`input.subagent_type: <plugin>:${componentId}\` appears in the transcript'\n` +
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
      `# its components in isolation. A scenario that exercises a single component in\n` +
      `# isolation belongs in that component's own per-skill suite, not here.\n` +
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
      `#   - agent-dispatched-after-skill:\n` +
      `#       check: 'A \`tool: Agent\` entry with \`input.subagent_type: <plugin>:<agent-id>\` appears after a \`tool: Skill\` entry with \`input.skill: <plugin>:<skill-id>\` in the same transcript'\n` +
      `#       note: 'Composition check: assert ONE interaction tying two components together (e.g. an ordering relation), not two independent presence checks merged into one'\n`,
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

// Coverage key for a component: `<type>-<id>` for named components, the
// literal id (`hooks` / `mcp-servers`) for singletons — the same convention
// the coverage matcher and placeholderDirName use.
function componentCoverageKey(componentType: PlaceholderComponentType, id: string): string {
  if (componentType === 'skill' || componentType === 'agent' || componentType === 'command') {
    return `${componentType}-${id}`;
  }
  return id;
}

async function writePlaceholderScenarios(
  rootDir: string,
  components: PluginComponents,
  scenariosPath: string,
  existingIds: string[],
): Promise<{ written: string[]; skipped: SkippedItem[] }> {
  const written: string[] = [];
  const skipped: SkippedItem[] = [];

  async function writeOne(componentType: PlaceholderComponentType, id: string): Promise<void> {
    const label =
      componentType === 'hooks' || componentType === 'mcp_servers' ? id : `${componentType} ${id}`;

    const key = componentCoverageKey(componentType, id);
    const cover = existingIds.find((existingId) => coversComponentKey(existingId, key));
    if (cover) {
      skipped.push({ label, reason: `covered by ${scenariosPath}/${cover}/` });
      return;
    }

    if (componentType === 'skill') {
      const nested = await discoverScenarios(join(rootDir, 'skills', id), 'evals');
      if (nested.length > 0) {
        skipped.push({ label, reason: `covered by skills/${id}/evals/` });
        return;
      }
    }

    const dirName = placeholderDirName(componentType, id);
    const dir = join(rootDir, scenariosPath, dirName);
    const dirExists = await access(dir).then(
      () => true,
      () => false,
    );
    if (dirExists) {
      skipped.push({ label, reason: `${scenariosPath}/${dirName}/ already exists` });
      return;
    }
    await mkdir(dir, { recursive: true });
    const rendered = renderPlaceholderScenario(componentType, id);
    await writeFile(join(dir, 'scenario.yaml'), rendered.scenarioYaml);
    await writeFile(join(dir, 'checks.yaml'), rendered.checksYaml);
    written.push(`${scenariosPath}/${dirName}/scenario.yaml`);
    written.push(`${scenariosPath}/${dirName}/checks.yaml`);
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
    const cover = existingIds.find((existingId) => coversComponentKey(existingId, 'composition'));
    const dir = join(rootDir, scenariosPath, 'composition-placeholder');
    const dirExists = await access(dir).then(
      () => true,
      () => false,
    );
    if (cover) {
      skipped.push({ label: 'composition', reason: `covered by ${scenariosPath}/${cover}/` });
    } else if (dirExists) {
      skipped.push({
        label: 'composition',
        reason: `${scenariosPath}/composition-placeholder/ already exists`,
      });
    } else {
      await mkdir(dir, { recursive: true });
      const rendered = renderCompositionPlaceholder();
      await writeFile(join(dir, 'scenario.yaml'), rendered.scenarioYaml);
      await writeFile(join(dir, 'checks.yaml'), rendered.checksYaml);
      written.push(`${scenariosPath}/composition-placeholder/scenario.yaml`);
      written.push(`${scenariosPath}/composition-placeholder/checks.yaml`);
    }
  }

  return { written, skipped };
}

// Best-effort read of scenarios.path from an existing evals.yaml. init is a
// scaffolder, not a validator — on any parse or shape problem it falls back to
// the default rather than erroring (`run` owns config validation). The shape
// rule mirrors loadEvalsConfig's: a single directory name, no separators.
async function readScenariosPathBestEffort(root: string): Promise<string> {
  const fallback = 'evals';
  try {
    const raw = await readFile(join(root, 'evals.yaml'), 'utf8');
    const parsed: unknown = parse(raw);
    if (typeof parsed !== 'object' || parsed === null) return fallback;
    const scenarios = (parsed as Record<string, unknown>).scenarios;
    if (typeof scenarios !== 'object' || scenarios === null) return fallback;
    const path = (scenarios as Record<string, unknown>).path;
    if (typeof path !== 'string' || path.length === 0) return fallback;
    if (path.includes('/') || path.includes('\\') || path === '.' || path === '..') {
      return fallback;
    }
    return path;
  } catch {
    return fallback;
  }
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
    `# max_error_rate:     # default: 0 when gating — any crashed rep fails (active only with min_pass_rate)\n` +
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
    `    #   - WebSearch\n` +
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

  await mkdir(resolvedDir, { recursive: true });

  const { mode } = await detectInitMode(resolvedDir);

  const created: string[] = [];
  const skipped: SkippedItem[] = [];

  const evalsYamlExists = await access(join(resolvedDir, 'evals.yaml')).then(
    () => true,
    () => false,
  );
  if (evalsYamlExists) {
    skipped.push({ label: 'evals.yaml', reason: 'already present' });
  } else {
    await writeFile(join(resolvedDir, 'evals.yaml'), renderEvalsYaml(mode));
    created.push('evals.yaml');
  }

  if (mode === 'plugin') {
    const scenariosPath = evalsYamlExists
      ? await readScenariosPathBestEffort(resolvedDir)
      : 'evals';
    const components = await enumeratePluginComponents(resolvedDir);
    const existingIds = (await discoverScenarios(resolvedDir, scenariosPath)).map((s) => s.id);
    const placeholders = await writePlaceholderScenarios(
      resolvedDir,
      components,
      scenariosPath,
      existingIds,
    );
    created.push(...placeholders.written);
    skipped.push(...placeholders.skipped);
  }

  if (created.length > 0) {
    process.stdout.write(`Created ${resolvedDir}/\n`);
    for (const relPath of created) {
      process.stdout.write(`  ${relPath}\n`);
    }
  } else {
    process.stdout.write(
      `Nothing to scaffold in ${resolvedDir}/ — all artifacts already present.\n`,
    );
  }

  if (skipped.length > 0) {
    process.stdout.write(`\nSkipped (already present):\n`);
    for (const item of skipped) {
      process.stdout.write(`  ${item.label} — ${item.reason}\n`);
    }
  }

  if (mode === 'plugin') {
    const manifest = await tryLoadPluginManifest(resolvedDir);
    if (manifest) {
      const versionSuffix = manifest.version ? ` (${manifest.version})` : '';
      process.stdout.write(`\nDetected plugin: ${manifest.name}${versionSuffix}\n`);
    }
  }

  if (created.length > 0) {
    process.stdout.write(`\nNext steps:\n`);
    if (created.some((p) => p.includes('composition-placeholder'))) {
      process.stdout.write(
        `  Turn evals/composition-placeholder/ into a real composition scenario (exercises two or more components; keep at least one cross-component check)\n`,
      );
    }
    process.stdout.write(`  Create evals/<scenario-id>/scenario.yaml and checks.yaml\n`);
    process.stdout.write(`  craboodle list ${dir}     # validate scenarios\n`);
    process.stdout.write(`  craboodle lint ${dir}     # check quality\n`);
    process.stdout.write(`  craboodle run ${dir}      # run eval pipeline\n`);
  }
}
