import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import type { VisualGoal } from './types.js';
import * as logger from './logger.js';

const DEFAULT_GOALS_FILENAME = 'goals.md';

export async function loadGoals(filePath?: string): Promise<VisualGoal[]> {
  // Resolve file path
  const resolvedPath = filePath
    ? resolve(filePath)
    : resolve(process.cwd(), DEFAULT_GOALS_FILENAME);

  if (!existsSync(resolvedPath)) {
    if (filePath) {
      logger.warn(`Goals file not found: ${resolvedPath}`);
    } else {
      logger.debug('No goals.md found in current directory, running without goals');
    }
    return [];
  }

  const content = await readFile(resolvedPath, 'utf-8');
  logger.info(`Loaded goals from ${resolvedPath}`);
  return parseGoalsMarkdown(content);
}

export function parseGoalsMarkdown(content: string): VisualGoal[] {
  const goals: VisualGoal[] = [];
  let currentScope: string | null = null;
  let currentGoals: string[] = [];

  const lines = content.split('\n');

  for (const line of lines) {
    const trimmed = line.trim();

    // Match ## headings
    const headingMatch = trimmed.match(/^##\s+(.+)$/);
    if (headingMatch) {
      // Save previous section
      if (currentScope !== null && currentGoals.length > 0) {
        goals.push({ scope: currentScope, goals: [...currentGoals] });
      }

      const heading = headingMatch[1].trim();

      // Determine scope
      if (/site[- ]wide\s+goals?/i.test(heading)) {
        currentScope = 'site-wide';
      } else {
        // Extract page path from "Page: /path" or just "/path"
        const pageMatch = heading.match(/^(?:Page:\s*)?(\/.*)$/i);
        if (pageMatch) {
          currentScope = pageMatch[1].trim();
        } else {
          // Treat as site-wide if no path prefix
          currentScope = 'site-wide';
        }
      }
      currentGoals = [];
      continue;
    }

    // Match bullet points (- or *)
    const bulletMatch = trimmed.match(/^[-*]\s+(.+)$/);
    if (bulletMatch && currentScope !== null) {
      currentGoals.push(bulletMatch[1].trim());
    }
  }

  // Save last section
  if (currentScope !== null && currentGoals.length > 0) {
    goals.push({ scope: currentScope, goals: [...currentGoals] });
  }

  logger.debug(`Parsed ${goals.length} goal section(s)`);
  return goals;
}

export function getGoalsForPage(pageUrl: string, allGoals: VisualGoal[]): string[] {
  const url = new URL(pageUrl);
  const pagePath = url.pathname.replace(/\/$/, '') || '/';

  const merged: string[] = [];

  for (const goalSet of allGoals) {
    if (goalSet.scope === 'site-wide') {
      merged.push(...goalSet.goals);
    } else {
      const goalPath = goalSet.scope.replace(/\/$/, '') || '/';
      if (pagePath === goalPath) {
        merged.push(...goalSet.goals);
      }
    }
  }

  return merged;
}

export function buildGoalPromptSection(goals: string[]): string {
  if (goals.length === 0) return '';

  const numbered = goals.map((g, i) => `${i + 1}. ${g}`).join('\n');

  return `
## Design Goals for This Page

The stakeholder has defined these specific visual goals. Evaluate the screenshot
against EACH goal and assess how well the current design achieves it.

Goals:
${numbered}

For each goal, provide:
- Alignment: strong / partial / weak
- What you observe in the current design related to this goal
- If partial or weak: what specific visual change would better communicate the intent
- Priority: how much fixing this gap would improve the page's effectiveness

After evaluating individual goals, provide an overall goal alignment score (0-100)
and your top 3 recommendations for making the design's visual language more clearly
express the stated intent.
`;
}

export function buildGoalComparisonSection(goals: string[]): string {
  if (goals.length === 0) return '';

  const numbered = goals.map((g, i) => `${i + 1}. ${g}`).join('\n');

  return `
## Goal Consistency Across Viewports

The stakeholder defined these goals:
${numbered}

Evaluate whether these goals are achieved consistently across all viewport sizes.
Does the visual hierarchy that communicates the intent on desktop still work on mobile?
Are any goals lost or weakened at specific breakpoints?
`;
}
