import { readFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import type {
  LookerConfig,
  ScreenshotEntry,
  CrossViewportAnalysis,
} from './types.js';
import {
  CrossViewportAnalysisSchema,
  DEFAULT_MODEL,
} from './types.js';
import { buildGoalComparisonSection } from './goals.js';
import { retryWithBackoff } from './retry.js';
import * as logger from './logger.js';

const COMPARISON_PROMPT = `You are reviewing the same page at multiple viewport sizes.

Compare these screenshots and assess:

1. **Responsive Breakpoint Quality**
   - Are breakpoints well-chosen?
   - Any awkward in-between states?

2. **Content Parity**
   - Is important content accessible at all sizes?
   - Anything hidden that shouldn't be?

3. **Navigation Adaptation**
   - Does navigation adapt appropriately?
   - Mobile menu usability

4. **Consistency Across Sizes**
   - Does the design feel cohesive?
   - Any jarring differences?

Viewports provided: {viewport_list}
Page: {url}

{goal_section}

IMPORTANT: Respond ONLY with valid JSON matching this exact structure (no markdown, no code fences):
{
  "breakpointQuality": "your analysis...",
  "contentParity": "your analysis...",
  "navigationAdaptation": "your analysis...",
  "consistencyAcrossSizes": "your analysis...",
  "goalConsistency": "goal consistency analysis or null if no goals",
  "issues": [
    {
      "severity": "critical|warning|info",
      "category": "layout|typography|color|responsiveness|polish|accessibility|goal-alignment|other",
      "description": "...",
      "element": "CSS selector or description, or null"
    }
  ]
}`;

function buildComparisonPrompt(
  url: string,
  viewportNames: string[],
  goals: string[],
): string {
  const goalSection = buildGoalComparisonSection(goals);

  return COMPARISON_PROMPT
    .replace('{viewport_list}', viewportNames.join(', '))
    .replace('{url}', url)
    .replace('{goal_section}', goalSection);
}

function parseComparisonResponse(raw: string): CrossViewportAnalysis {
  let jsonStr = raw.trim();

  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim();
  }

  try {
    const parsed = JSON.parse(jsonStr);
    const result = CrossViewportAnalysisSchema.safeParse(parsed);

    if (result.success) {
      return { ...result.data, rawResponse: raw };
    }

    logger.debug(`Comparison response didn't fully validate: ${result.error.message}`);
    return {
      breakpointQuality: parsed.breakpointQuality ?? '',
      contentParity: parsed.contentParity ?? '',
      navigationAdaptation: parsed.navigationAdaptation ?? '',
      consistencyAcrossSizes: parsed.consistencyAcrossSizes ?? '',
      goalConsistency: parsed.goalConsistency ?? null,
      issues: Array.isArray(parsed.issues) ? parsed.issues : [],
      rawResponse: raw,
    };
  } catch {
    logger.warn('Could not parse comparison as JSON');
    return {
      breakpointQuality: raw,
      contentParity: '',
      navigationAdaptation: '',
      consistencyAcrossSizes: '',
      goalConsistency: null,
      issues: [],
      rawResponse: raw,
    };
  }
}

export async function compareViewports(
  url: string,
  screenshots: Map<string, ScreenshotEntry>,
  goals: string[],
  config: LookerConfig,
): Promise<CrossViewportAnalysis | null> {
  if (screenshots.size < 2) return null;

  const provider = config.analysis?.provider ?? 'claude';

  // Load all screenshots as base64, skipping any missing files
  const imageContents: Array<{ name: string; base64: string }> = [];
  for (const [name, entry] of screenshots) {
    if (!existsSync(entry.filePath)) {
      logger.warn(`Skipping missing screenshot for comparison: ${name} (${entry.filePath})`);
      continue;
    }
    const buffer = await readFile(entry.filePath);
    imageContents.push({ name, base64: buffer.toString('base64') });
  }

  // Need at least 2 viewports for meaningful comparison
  if (imageContents.length < 2) {
    logger.debug(`Only ${imageContents.length} viewport(s) available for comparison of ${url} — skipping`);
    return null;
  }

  const viewportNames = imageContents.map((img) => img.name);
  const prompt = buildComparisonPrompt(url, viewportNames, goals);

  const raw = await retryWithBackoff(
    async () => {
      if (provider === 'openai') {
        return compareWithOpenAI(imageContents, prompt, config);
      }
      return compareWithClaude(imageContents, prompt, config);
    },
    {
      attempts: 3,
      onRetry: (err, attempt) => {
        logger.debug(`Comparison API retry ${attempt} for ${url}: ${err}`);
      },
    },
  );

  return parseComparisonResponse(raw);
}

async function compareWithClaude(
  images: Array<{ name: string; base64: string }>,
  prompt: string,
  config: LookerConfig,
): Promise<string> {
  const apiKey = config.analysis?.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) throw new Error('ANTHROPIC_API_KEY not set');

  const client = new Anthropic({ apiKey });
  const model = config.analysis?.model ?? DEFAULT_MODEL;

  const content: Anthropic.MessageCreateParams['messages'][0]['content'] = [];

  for (const img of images) {
    content.push({
      type: 'text',
      text: `--- ${img.name} viewport ---`,
    });
    content.push({
      type: 'image',
      source: {
        type: 'base64',
        media_type: 'image/png',
        data: img.base64,
      },
    });
  }

  content.push({ type: 'text', text: prompt });

  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    messages: [{ role: 'user', content }],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  return textBlock?.text ?? '';
}

async function compareWithOpenAI(
  images: Array<{ name: string; base64: string }>,
  prompt: string,
  config: LookerConfig,
): Promise<string> {
  const apiKey = config.analysis?.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) throw new Error('OPENAI_API_KEY not set');

  const client = new OpenAI({ apiKey, baseURL: config.analysis?.apiUrl });
  const model = config.analysis?.model ?? 'gpt-4o';

  const content: OpenAI.Chat.Completions.ChatCompletionContentPart[] = [];

  for (const img of images) {
    content.push({ type: 'text', text: `--- ${img.name} viewport ---` });
    content.push({
      type: 'image_url',
      image_url: { url: `data:image/png;base64,${img.base64}` },
    });
  }

  content.push({ type: 'text', text: prompt });

  const response = await client.chat.completions.create({
    model,
    max_tokens: 4096,
    messages: [{ role: 'user', content }],
  });

  return response.choices[0]?.message?.content ?? '';
}
