import { isProjectAllowed } from './privacy.js';

const managedSources = new Set(['codex', 'claude', 'cursor', 'grok']);

/** Keep explicit off-rules for removed projects so cached/global hooks cannot
 * resume collection merely because the broader project policy is "all". */
export function reconcileAgentPolicy(previousRules, previousProjects, nextProjects) {
  const rules = new Map();
  for (const rule of Array.isArray(previousRules) ? previousRules : []) {
    if (typeof rule?.path === 'string' && Array.isArray(rule.agents) && rule.agents.length === 0) {
      rules.set(rule.path, { path: rule.path, agents: [] });
    }
  }
  for (const project of previousProjects) rules.set(project.path, { path: project.path, agents: [] });
  for (const project of nextProjects) rules.set(project.path, { path: project.path, agents: [...project.agents] });
  return [...rules.values()];
}

/** Only explicitly managed project/source pairs change legacy collection.
 * A more specific child project overrides its parent's agent choices. */
export function isAgentAllowed(projectPath, source, rules) {
  if (typeof source !== 'string' || !managedSources.has(source.toLowerCase())) return true;
  let selected = null;
  for (const rule of Array.isArray(rules) ? rules : []) {
    if (typeof rule?.path !== 'string' || !Array.isArray(rule.agents)) continue;
    if (isProjectAllowed(projectPath, { mode: 'allowlist', allowedProjects: [rule.path] })
      && (!selected || rule.path.length > selected.path.length)) selected = rule;
  }
  return !selected || selected.agents.includes(source.toLowerCase());
}
