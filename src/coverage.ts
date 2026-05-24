import type { PluginComponents } from './plugin.js';

export interface PluginCoverage {
  skills: Record<string, number>;
  agents: Record<string, number>;
  commands: Record<string, number>;
  hooks: number;
  mcp_servers: number;
}

export function computePluginCoverage(
  scenarioIds: string[],
  components: PluginComponents,
): PluginCoverage {
  return {
    skills: countByPrefix(scenarioIds, components.skills, 'skill'),
    agents: countByPrefix(scenarioIds, components.agents, 'agent'),
    commands: countByPrefix(scenarioIds, components.commands, 'command'),
    hooks: components.hasHooks ? countSingleton(scenarioIds, 'hooks') : 0,
    mcp_servers: components.hasMcpServers ? countSingleton(scenarioIds, 'mcp') : 0,
  };
}

function countByPrefix(
  scenarioIds: string[],
  componentIds: string[],
  type: string,
): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const id of componentIds) {
    counts[id] = 0;
  }
  const sortedIds = [...componentIds].sort((a, b) => b.length - a.length);
  for (const scenarioId of scenarioIds) {
    for (const componentId of sortedIds) {
      const exact = `${type}-${componentId}`;
      if (scenarioId === exact || scenarioId.startsWith(`${exact}-`)) {
        counts[componentId] += 1;
        break;
      }
    }
  }
  return counts;
}

function countSingleton(scenarioIds: string[], type: string): number {
  let count = 0;
  for (const scenarioId of scenarioIds) {
    if (scenarioId === type || scenarioId.startsWith(`${type}-`)) {
      count += 1;
    }
  }
  return count;
}
