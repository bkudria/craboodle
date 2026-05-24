import { access, readFile, readdir } from 'node:fs/promises';
import type { Dirent } from 'node:fs';
import { join } from 'node:path';
import { z } from 'zod';

const PluginAuthorObjectSchema = z
  .object({
    name: z.string(),
    email: z.string().optional(),
    url: z.string().optional(),
  })
  .passthrough();

const PluginManifestSchema = z
  .object({
    name: z.string().min(1),
    description: z.string().optional(),
    version: z.string().optional(),
    license: z.string().optional(),
    repository: z.string().optional(),
    homepage: z.string().optional(),
    keywords: z.array(z.string()).optional(),
    author: z.union([z.string(), PluginAuthorObjectSchema]).optional(),
  })
  .passthrough();

export type PluginManifest = z.infer<typeof PluginManifestSchema>;

export async function loadPluginManifest(pluginRoot: string): Promise<PluginManifest> {
  const path = join(pluginRoot, '.claude-plugin', 'plugin.json');
  const content = await readFile(path, 'utf8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(content);
  } catch (err) {
    throw new Error(`Failed to parse ${path}: ${(err as Error).message}`, { cause: err });
  }
  return PluginManifestSchema.parse(parsed);
}

export interface PluginComponents {
  skills: string[];
  agents: string[];
  commands: string[];
  hasHooks: boolean;
  hasMcpServers: boolean;
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function listSkillIds(pluginRoot: string): Promise<string[]> {
  const skillsDir = join(pluginRoot, 'skills');
  let entries: Dirent[];
  try {
    entries = await readdir(skillsDir, { withFileTypes: true });
  } catch {
    return [];
  }
  const ids: string[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    if (await fileExists(join(skillsDir, entry.name, 'SKILL.md'))) {
      ids.push(entry.name);
    }
  }
  return ids.sort();
}

async function listMarkdownIds(pluginRoot: string, dirname: string): Promise<string[]> {
  let entries: Dirent[];
  try {
    entries = await readdir(join(pluginRoot, dirname), { withFileTypes: true });
  } catch {
    return [];
  }
  const ids: string[] = [];
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (!entry.name.endsWith('.md')) continue;
    ids.push(entry.name.slice(0, -'.md'.length));
  }
  return ids.sort();
}

export async function enumeratePluginComponents(pluginRoot: string): Promise<PluginComponents> {
  const [skills, agents, commands, hasHooks, hasMcpServers] = await Promise.all([
    listSkillIds(pluginRoot),
    listMarkdownIds(pluginRoot, 'agents'),
    listMarkdownIds(pluginRoot, 'commands'),
    fileExists(join(pluginRoot, 'hooks', 'hooks.json')),
    fileExists(join(pluginRoot, '.mcp.json')),
  ]);
  return {
    skills,
    agents,
    commands,
    hasHooks,
    hasMcpServers,
  };
}
