import { dirname, join, resolve } from 'node:path';
import { readFile } from 'node:fs/promises';
import { stringify, parse } from 'yaml';
import { formatErrorWithHint } from '../messages.js';
import { filterScenarios } from '../discovery.js';
import { findMissingBinaries, formatMissingBinariesError } from '../preflight.js';
import { listScuttlerunConfig } from '../runner.js';
import { prepareRun } from '../prepare-run.js';
import { writeYamlArrayItem } from '../output.js';

export interface ListOptions {
  scenarios?: string;
  verbose?: boolean;
}

export async function listCommand(root: string, opts: ListOptions): Promise<void> {
  const resolvedRoot = resolve(root);

  // Pre-flight: scuttlerun is required for --dry-run validation
  const missing = await findMissingBinaries(['scuttlerun']);
  if (missing.length > 0) {
    process.stderr.write(formatMissingBinariesError(missing));
    process.exit(4);
  }

  // Load evals.yaml, stage filtered view, materialise scuttlerun base, discover.
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
    process.exit(4);
  }

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
      process.exit(4);
    }
  }

  const basePath = prepared.basePath;

  // Output base config summary
  const baseSummary: Record<string, unknown> = { version: prepared.pipeline.version };
  if (prepared.pipeline.minPassRate !== undefined)
    baseSummary.min_pass_rate = prepared.pipeline.minPassRate;
  process.stdout.write(stringify({ base: baseSummary }, { lineWidth: 0 }));

  // Validate each scenario
  process.stdout.write(`scenarios:\n`);
  let totalChecks = 0;
  let invalidCount = 0;

  for (const scenario of scenarios) {
    try {
      // Parse checks.yaml to count checks
      const checksPath = join(dirname(scenario.configPath), 'checks.yaml');
      const checksContent = await readFile(checksPath, 'utf8');
      const checksData = parse(checksContent) as Record<string, unknown>;
      const checksArray = checksData.checks;
      const checkCount = Array.isArray(checksArray)
        ? checksArray.length
        : Object.keys(checksData).length;
      totalChecks += checkCount;

      const item: Record<string, unknown> = {
        id: scenario.id,
        checks: checkCount,
      };

      // Validate merged scuttlerun config via subprocess
      const result = await listScuttlerunConfig({
        scenarioPath: scenario.configPath,
        basePath,
      });

      item.valid = result.success;
      if (!result.success) {
        item.error = result.error.message;
        invalidCount++;
      }

      process.stdout.write(writeYamlArrayItem(item) + '\n');
    } catch (err: unknown) {
      process.stderr.write(
        `[craboodle] Config error in ${scenario.id}: ${err instanceof Error ? err.message : String(err)}\n`,
      );
      process.exit(1);
    }
  }

  process.stdout.write(
    stringify({ total: `${scenarios.length} scenarios, ${totalChecks} checks` }, { lineWidth: 0 }),
  );
  if (invalidCount > 0) {
    process.stdout.write(stringify({ invalid: invalidCount }, { lineWidth: 0 }));
    process.exit(1);
  }
}
