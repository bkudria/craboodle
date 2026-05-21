import { dirname, join, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { parse } from 'yaml';
import { formatErrorWithHint } from '../messages.js';
import { installSignalHandler } from '../signals.js';
import { filterScenarios } from '../discovery.js';
import { findMissingBinaries, formatMissingBinariesError } from '../preflight.js';
import { runPincenezLint } from '../runner.js';
import { prepareRun } from '../prepare-run.js';
import {
  parseLintResult,
  streamLintScenarioYaml,
  streamLintTotals,
  type LintTotals,
} from '../output.js';
import { EXIT_CONFIG_ERROR, EXIT_INFRA_ERROR, EXIT_SIGINT } from '../exit-codes.js';

export interface LintOptions {
  concurrency: number;
  graderModel?: string;
  scenarios?: string;
  verbose?: boolean;
}

export async function lintCommand(root: string, opts: LintOptions): Promise<void> {
  const controller = new AbortController();
  let interrupted = false;
  const uninstallSignal = installSignalHandler({
    controller,
    onFirstSignal: () => {
      interrupted = true;
    },
  });

  try {
    return await lintCommandInner(root, opts, controller, () => interrupted);
  } finally {
    uninstallSignal();
    if (interrupted) {
      process.exit(EXIT_SIGINT);
    }
  }
}

async function lintCommandInner(
  root: string,
  opts: LintOptions,
  controller: AbortController,
  isInterrupted: () => boolean,
): Promise<void> {
  const resolvedRoot = resolve(root);

  // Pre-flight: pincenez is required for lint
  const missing = await findMissingBinaries(['pincenez']);
  if (missing.length > 0) {
    process.stderr.write(formatMissingBinariesError(missing));
    process.exit(EXIT_INFRA_ERROR);
  }

  // Load evals.yaml + discover. Lint doesn't itself need the staged base, but
  // sharing prepareRun keeps validation + discovery uniform across commands.
  const prepared = await prepareRun(resolvedRoot);
  let scenarios = prepared.scenarios;
  if (scenarios.length === 0) {
    process.stderr.write(
      formatErrorWithHint(
        `No scenarios found in ${resolvedRoot}`,
        `craboodle init ${resolvedRoot}`,
        'craboodle --help',
      ),
    );
    process.exit(EXIT_INFRA_ERROR);
  }

  // Apply scenario filter
  if (opts.scenarios) {
    scenarios = filterScenarios(scenarios, opts.scenarios);
    if (scenarios.length === 0) {
      process.stderr.write(
        formatErrorWithHint(
          `No scenarios match filter: ${opts.scenarios}`,
          `craboodle list ${resolvedRoot} to see available IDs`,
          'craboodle --help',
        ),
      );
      process.exit(EXIT_INFRA_ERROR);
    }
  }

  if (opts.verbose) {
    process.stderr.write(`[craboodle] Linting ${scenarios.length} scenario(s)\n`);
  }

  // Stream header
  process.stdout.write('scenarios:\n');

  // Run pincenez lint per scenario with concurrency control
  const { default: pLimit } = await import('p-limit');
  const limit = pLimit(opts.concurrency);

  const totals: LintTotals = {
    scenarios_total: 0,
    scenarios_with_issues: 0,
    checks_total: 0,
    checks_with_issues: 0,
  };
  let hasAnySuccess = false;

  const promises = scenarios.map((scenario) =>
    limit(async () => {
      const checksPath = join(dirname(scenario.configPath), 'checks.yaml');

      if (opts.verbose) {
        process.stderr.write(`[craboodle] ${scenario.id}: linting checks\n`);
      }

      // Read scenario prompt to pass as context for tautological detection
      let context: string | undefined;
      try {
        const scenarioContent = await readFile(scenario.configPath, 'utf8');
        const scenarioYaml = parse(scenarioContent) as Record<string, unknown>;
        if (typeof scenarioYaml?.prompt === 'string') {
          context = scenarioYaml.prompt;
        }
      } catch {
        // scenario.yaml is optional for lint — proceed without context
      }

      if (context === undefined) {
        process.stderr.write(
          `[craboodle] ${scenario.id}: scenario has no prompt; tautology detection degraded\n`,
        );
      }

      const result = await runPincenezLint({
        checksPath,
        graderModel: opts.graderModel,
        context,
        signal: controller.signal,
      });

      if (!result.success) {
        process.stderr.write(
          `[craboodle] ${scenario.id}: pincenez lint failed: ${result.error.message}\n`,
        );
        return;
      }

      hasAnySuccess = true;
      const checks = parseLintResult(result.stdout);
      const withIssues = checks.filter((a) => a.issues.length > 0).length;

      totals.scenarios_total += 1;
      totals.checks_total += checks.length;
      totals.checks_with_issues += withIssues;
      if (withIssues > 0) {
        totals.scenarios_with_issues += 1;
      }

      streamLintScenarioYaml({
        id: scenario.id,
        checks,
        checks_total: checks.length,
        checks_with_issues: withIssues,
      });
    }),
  );

  await Promise.allSettled(promises);

  // Stream totals
  streamLintTotals(totals);

  if (isInterrupted()) {
    return;
  }

  if (!hasAnySuccess) {
    process.exit(EXIT_INFRA_ERROR);
  }

  if (totals.checks_with_issues > 0) {
    process.exit(EXIT_CONFIG_ERROR);
  }
}
