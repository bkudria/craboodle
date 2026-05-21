import { access, mkdir, readdir, stat, writeFile } from 'node:fs/promises';
import { join, resolve } from 'node:path';
import { formatErrorWithHint } from '../messages.js';
import { EXIT_CONFIG_ERROR } from '../exit-codes.js';

async function detectInitMode(
  root: string,
): Promise<{ mode: 'skill' | 'plugin' | 'generic'; firstPluginSkill?: string }> {
  const hasPluginMarker = await access(join(root, '.claude-plugin', 'plugin.json')).then(
    () => true,
    () => false,
  );
  if (hasPluginMarker) {
    try {
      const skillsDir = join(root, 'skills');
      const entries = await readdir(skillsDir, { withFileTypes: true });
      for (const e of entries.sort((a, b) => a.name.localeCompare(b.name))) {
        if (!e.isDirectory()) continue;
        const hasSkillMd = await access(join(skillsDir, e.name, 'SKILL.md')).then(
          () => true,
          () => false,
        );
        if (hasSkillMd) return { mode: 'plugin', firstPluginSkill: e.name };
      }
    } catch {
      // skills/ dir doesn't exist
    }
    return { mode: 'plugin' };
  }
  const hasSkillMd = await access(join(root, 'SKILL.md')).then(
    () => true,
    () => false,
  );
  if (hasSkillMd) return { mode: 'skill' };
  return { mode: 'generic' };
}

function renderEvalsYaml(mode: 'skill' | 'plugin' | 'generic', firstPluginSkill?: string): string {
  let skillsBlock: string;
  if (mode === 'skill') {
    skillsBlock = `#   skills:\n#     - .                            # self-reference: this skill\n`;
  } else if (mode === 'plugin' && firstPluginSkill) {
    skillsBlock = `#   skills:\n#     - skills/${firstPluginSkill}\n`;
  } else if (mode === 'plugin') {
    skillsBlock = `#   skills:\n#     - skills/<your-skill-id>       # path relative to this evals.yaml\n`;
  } else {
    skillsBlock = `#   skills:\n#     - /absolute/path/to/skill\n`;
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
    skillsBlock +
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

  const { mode, firstPluginSkill } = await detectInitMode(resolvedDir);
  await writeFile(join(resolvedDir, 'evals.yaml'), renderEvalsYaml(mode, firstPluginSkill));

  process.stdout.write(`Created ${resolvedDir}/\n`);
  process.stdout.write(`  evals.yaml\n`);
  process.stdout.write(`\nNext steps:\n`);
  process.stdout.write(`  Create evals/<scenario-id>/scenario.yaml and checks.yaml\n`);
  process.stdout.write(`  craboodle list ${dir}     # validate scenarios\n`);
  process.stdout.write(`  craboodle lint ${dir}     # check quality\n`);
  process.stdout.write(`  craboodle run ${dir}      # run eval pipeline\n`);
}
