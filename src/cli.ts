#!/usr/bin/env node

import { Command } from 'commander';
import { dirname, join } from 'node:path';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

import { formatCommandError } from './errors.js';
import { HELP_TEXT } from './help-text.js';
import { parseConcurrency } from './cli-utils.js';
import { runCommand } from './commands/run.js';
import { listCommand } from './commands/list.js';
import { lintCommand } from './commands/lint.js';
import { initCommand } from './commands/init.js';
import { EXIT_RUNTIME_ERROR } from './exit-codes.js';

const pkg = JSON.parse(
  readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'package.json'), 'utf8'),
) as { version: string };

const program = new Command();

program
  .name('craboodle')
  .description('Eval pipeline orchestrator for Claude Code')
  .version(pkg.version)
  .addHelpText('after', HELP_TEXT);

program
  .command('run <root>')
  .description('Run eval pipeline')
  .option(
    '--repeats <n>',
    'Number of repetitions per scenario (overrides evals.yaml repeats; default: 3)',
  )
  .option(
    '--concurrency <n>',
    'Max parallel items per stage (scuttlerun and pincenez run in independent pools)',
    parseConcurrency,
    10,
  )
  .option(
    '--timeout <seconds>',
    'Per-scenario scuttlerun session timeout in seconds (positive integer; overrides evals.yaml timeout)',
  )
  .option(
    '--scenario, --scenarios <pattern>',
    'Filter scenarios by ID (exact, glob, or comma-separated)',
  )
  .option('--agent-model <model>', 'Override scuttlerun model for all scenarios')
  .option('--grader-model <model>', 'Override pincenez model for all checks')
  .option('-v, --verbose', 'Verbose logging (to stderr)')
  .action(async (root: string, cmdOpts: Record<string, string>) => {
    try {
      await runCommand(root, {
        repeats: cmdOpts.repeats,
        concurrency: parseInt(cmdOpts.concurrency, 10),
        timeout: cmdOpts.timeout,
        agentModel: cmdOpts.agentModel,
        graderModel: cmdOpts.graderModel,
        scenarios: cmdOpts.scenarios,
        verbose: !!cmdOpts.verbose,
      });
    } catch (err: unknown) {
      process.stderr.write(formatCommandError(err));
      process.exit(EXIT_RUNTIME_ERROR);
    }
  });

program
  .command('list <root>')
  .description('List and validate scenarios (including scuttlerun config validation)')
  .option(
    '--scenario, --scenarios <pattern>',
    'Filter scenarios by ID (exact, glob, or comma-separated)',
  )
  .option('-v, --verbose', 'Verbose logging (to stderr)')
  .action(async (root: string, cmdOpts: { scenarios?: string; verbose?: boolean }) => {
    try {
      await listCommand(root, cmdOpts);
    } catch (err: unknown) {
      process.stderr.write(formatCommandError(err));
      process.exit(EXIT_RUNTIME_ERROR);
    }
  });

program
  .command('lint <root>')
  .description('Lint checks for quality issues without running evals')
  .option('--concurrency <n>', 'Max parallel pincenez lint invocations', parseConcurrency, 10)
  .option(
    '--scenario, --scenarios <pattern>',
    'Filter scenarios by ID (exact, glob, or comma-separated)',
  )
  .option('--grader-model <model>', 'Override pincenez model for linting')
  .option('-v, --verbose', 'Verbose logging (to stderr)')
  .action(async (root: string, cmdOpts: Record<string, string>) => {
    try {
      await lintCommand(root, {
        concurrency: parseInt(cmdOpts.concurrency, 10),
        graderModel: cmdOpts.graderModel,
        scenarios: cmdOpts.scenarios,
        verbose: !!cmdOpts.verbose,
      });
    } catch (err: unknown) {
      process.stderr.write(formatCommandError(err));
      process.exit(EXIT_RUNTIME_ERROR);
    }
  });

program
  .command('init <dir>')
  .description('Scaffold an evals.yaml at the given skill/plugin root')
  .action(async (dir: string) => {
    await initCommand(dir);
  });

program.parse();
