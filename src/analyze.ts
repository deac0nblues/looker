import { readFile } from 'node:fs/promises';
import Anthropic from '@anthropic-ai/sdk';
import OpenAI from 'openai';
import { z } from 'zod';
import type {
  LookerConfig,
  ViewportConfig,
  PageAnalysis,
  GoalAssessment,
} from './types.js';
import {
  PageAnalysisSchema,
  GoalAssessmentSchema,
  DEFAULT_MODEL,
} from './types.js';
import { buildGoalPromptSection } from './goals.js';
import { retryWithBackoff } from './retry.js';
import * as logger from './logger.js';

// --- Prompts ---

const BASE_ANALYSIS_PROMPT = `You are the most annoyingly detail-obsessed designer on the team. The one who submits 47 comments on a PR that "looks fine" to everyone else. The one who keeps a personal blacklist of font pairings. The one who can spot 1px misalignment from across the room and considers "good enough" a personal insult.

You care deeply about craft. You reference design principles by name because you believe in them. You have strong opinions about spacing, typography, color, and layout — and you back them up. You are not mean, but you are relentless. Your feedback makes things better, even when people roll their eyes at first.

Review this screenshot with the intensity of someone who genuinely believes the details are the design.

---

## 1. Layout & Hierarchy

Evaluate the spatial architecture of this page:

- **Visual hierarchy**: Is there a clear F-pattern or Z-pattern reading flow? Can you identify the primary, secondary, and tertiary focal points within 2 seconds? If the hierarchy is ambiguous, that is a failure — not a "nice to have" fix.
- **Spatial rhythm**: Is the spacing system consistent? Look for an underlying grid (ideally 8px baseline or 4px sub-grid). Call out anywhere the spacing feels arbitrary — padding that doesn't match the system, margins that break the vertical rhythm.
- **Gestalt grouping**: Are related elements grouped by proximity? Is there enough separation between unrelated sections? Apply the Law of Proximity and Common Region — if you have to guess whether two things are related, the spacing is wrong.
- **Alignment**: Check for optical alignment, not just mathematical alignment. Are text blocks, images, and UI elements snapping to a visible grid? Call out even minor drift — 2px of misalignment is visible and signals sloppiness.
- **Whitespace**: Is whitespace used intentionally for emphasis, or does it just feel like leftover space? Generous whitespace around CTAs and headings signals confidence. Cramped layouts signal indecision.

If the layout is "fine," tell me what would make it commanding.

## 2. Typography

Typography is the backbone of visual design. Evaluate with extreme prejudice:

- **Type scale**: Is there a clear modular scale (Major Third 1.25, Perfect Fourth 1.333, etc.)? Or do the sizes feel randomly chosen? Count the distinct font sizes — if there are more than 5-6 in the visible hierarchy, the scale is probably undisciplined.
- **Font pairing**: If multiple typefaces are used, is the pairing intentional? A geometric sans with a humanist serif works. Two similar sans-serifs fighting each other does not. Name what you see and whether the pairing has logic.
- **Line height**: Body text should be 1.5-1.75x the font size. Headings should be tighter (1.1-1.3x). If the leading looks too loose or too tight, say so and give the specific ratio that would fix it.
- **Measure (line length)**: Optimal is 45-75 characters per line for body text. If paragraphs stretch beyond 80ch on this viewport, readability suffers. If they are under 30ch, it feels fragmented.
- **Letter-spacing and weight**: Are headings tracked appropriately? All-caps text without added letter-spacing (0.05-0.1em) is a rookie mistake. Are font weights used to create hierarchy, or is everything medium-weight mush?
- **Orphans and widows**: Call out any visible single-word lines at the end of paragraphs or headings that awkwardly wrap to a second line with one word.

Do not accept "the typography is readable" as sufficient. Readable is the floor. I want to know if it has personality, rhythm, and intention.

## 3. Color & Contrast

Evaluate the color system with a designer's eye and an accessibility advocate's conscience:

- **Palette discipline**: Does the page use a coherent, limited palette? Apply the 60-30-10 rule — is there a dominant color (60%), secondary (30%), and accent (10%)? Or is it a color free-for-all?
- **Contrast ratios**: WCAG AA is the legal minimum (4.5:1 for body text, 3:1 for large text). Push for AAA (7:1 / 4.5:1). If you see light gray text on white, or colored text on colored backgrounds that look questionable, flag it even if it technically scrapes past AA.
- **Semantic color use**: Are colors used meaningfully? Success/error/warning states should use consistent, distinct colors. Interactive elements should have a clear color language that differentiates them from static content.
- **Saturation and harmony**: Are the colors harmonious (complementary, analogous, triadic)? Or do some hues feel like they wandered in from a different brand? High saturation on large areas is visually aggressive.
- **Dark/light mode considerations**: Even if only one mode is shown, note if the color choices would survive a mode switch or if they are fragile (e.g., relying on pure black #000 or pure white #FFF without any tonal range).

## 4. Responsiveness (Viewport: {viewport_name}, {width}px x {height}px)

Evaluate how well the design adapts to this specific viewport:

- **Content reflow**: Does content reflow naturally, or does it feel like the desktop layout was squeezed into a smaller container? Stacking should feel intentional, not like a CSS accident.
- **Touch targets (mobile/tablet)**: Apply Fitts's Law. Interactive elements should be at least 44x44px with adequate spacing between them. If two tappable elements are within 8px of each other, that is a critical usability problem.
- **Text sizing**: Can all text be read without zooming? Body text below 14px on mobile is a problem. Navigation labels below 12px are a problem.
- **Horizontal overflow**: Any horizontal scrolling on this viewport? That is almost always a bug. Look for images, code blocks, or tables that break the container.
- **Viewport-appropriate density**: Mobile should feel spacious and scannable. Desktop can be denser. If the mobile view feels cramped or the desktop view feels empty, the responsive strategy needs work.
- **Image handling**: Are images sized appropriately for this viewport? Oversized hero images that push content below the fold on mobile are a common sin.

## 5. Visual Polish

This is where craft separates professional work from templates:

- **Consistency**: Are border-radius values consistent across similar elements? Are shadow depths consistent across the same elevation level? Are icon sizes and stroke weights uniform? Inconsistency here screams "multiple developers, no design system."
- **Micro-interactions and states**: Can you see hover/focus/active states? Are interactive elements visually distinct from static content? Buttons that look like plain text are a UX failure.
- **Pixel precision**: Look for subtle issues — borders that are 1px in some places and 2px in others, inconsistent padding inside cards, images that aren't quite aligned with adjacent text.
- **Visual noise**: Are there unnecessary borders, dividers, or decorative elements that add clutter without aiding comprehension? Every visual element should earn its place.
- **Professional finish**: Does this feel like something a design-led company would ship, or does it feel like a developer built it without design review? Be honest and specific about what creates that impression.

---

Viewport: {viewport_name} ({width}x{height})
Page: {url}

Be ruthlessly specific. Reference exact elements, approximate measurements, and specific design principles. If something is "fine," explain what would make it exceptional. Do not pull punches, but keep your tone as a passionate colleague who raises the bar.`;

const JSON_FORMAT_INSTRUCTION = `

IMPORTANT: Respond ONLY with valid JSON matching this exact structure (no markdown, no code fences):
{
  "feedback": {
    "layoutAndHierarchy": "your analysis...",
    "typography": "your analysis...",
    "colorAndContrast": "your analysis...",
    "responsiveness": "your analysis...",
    "visualPolish": "your analysis..."
  },
  "issues": [
    {
      "severity": "critical|warning|info",
      "category": "layout|typography|color|responsiveness|polish|accessibility|goal-alignment|other",
      "description": "...",
      "element": "CSS selector or description, or null"
    }
  ],
  "goalAssessments": [
    {
      "goal": "the goal text",
      "alignment": "strong|partial|weak",
      "observation": "what you see...",
      "gap": "what's missing, or null if strong",
      "suggestion": "specific change, or null if strong"
    }
  ],
  "overallGoalAlignment": null,
  "topRecommendations": ["rec 1", "rec 2", "rec 3"]
}

If no goals were provided, set goalAssessments to [] and overallGoalAlignment to null.`;

function buildPrompt(
  url: string,
  viewport: ViewportConfig,
  goals: string[],
  customPromptText?: string,
  focus?: string,
): string {
  let prompt = customPromptText ?? BASE_ANALYSIS_PROMPT;

  // Replace template variables
  prompt = prompt
    .replace(/\{viewport_name\}/g, viewport.name)
    .replace(/\{width\}/g, String(viewport.width))
    .replace(/\{height\}/g, String(viewport.height))
    .replace(/\{url\}/g, url);

  // Inject goals section
  const goalSection = buildGoalPromptSection(goals);
  if (goalSection) {
    prompt = goalSection + '\n\n' + prompt;
  }

  // Focus instruction
  if (focus) {
    prompt += `\n\nFOCUS: Pay special attention to "${focus}" in your analysis.`;
  }

  prompt += JSON_FORMAT_INSTRUCTION;

  return prompt;
}

function parseAnalysisResponse(raw: string): PageAnalysis {
  // Try to extract JSON from the response
  let jsonStr = raw.trim();

  // Remove markdown code fences if present
  const fenceMatch = jsonStr.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenceMatch) {
    jsonStr = fenceMatch[1].trim();
  }

  try {
    const parsed = JSON.parse(jsonStr);
    const result = PageAnalysisSchema.safeParse(parsed);

    if (result.success) {
      return { ...result.data, rawResponse: raw };
    }

    // Partial parse — try to extract what we can
    logger.debug(`Analysis response didn't fully validate: ${result.error.message}`);
    return {
      feedback: parsed.feedback ?? {
        layoutAndHierarchy: '',
        typography: '',
        colorAndContrast: '',
        responsiveness: '',
        visualPolish: '',
      },
      issues: Array.isArray(parsed.issues) ? parsed.issues : [],
      goalAssessments: Array.isArray(parsed.goalAssessments) ? parsed.goalAssessments : [],
      overallGoalAlignment: parsed.overallGoalAlignment ?? null,
      topRecommendations: Array.isArray(parsed.topRecommendations)
        ? parsed.topRecommendations
        : [],
      rawResponse: raw,
    };
  } catch {
    // JSON parse failed — return raw as feedback
    logger.warn('Could not parse analysis as JSON, returning raw response');
    return {
      feedback: {
        layoutAndHierarchy: raw,
        typography: '',
        colorAndContrast: '',
        responsiveness: '',
        visualPolish: '',
      },
      issues: [],
      goalAssessments: [],
      overallGoalAlignment: null,
      topRecommendations: [],
      rawResponse: raw,
    };
  }
}

// --- Claude Analysis ---

async function analyzeWithClaude(
  screenshotBase64: string,
  prompt: string,
  config: LookerConfig,
): Promise<string> {
  const apiKey = config.analysis?.apiKey ?? process.env.ANTHROPIC_API_KEY;
  if (!apiKey) {
    throw new Error('ANTHROPIC_API_KEY not set. Provide via --api-key or environment variable.');
  }

  const client = new Anthropic({ apiKey });
  const model = config.analysis?.model ?? DEFAULT_MODEL;

  const response = await client.messages.create({
    model,
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image',
            source: {
              type: 'base64',
              media_type: 'image/png',
              data: screenshotBase64,
            },
          },
          {
            type: 'text',
            text: prompt,
          },
        ],
      },
    ],
  });

  const textBlock = response.content.find((b) => b.type === 'text');
  return textBlock?.text ?? '';
}

// --- OpenAI Analysis ---

async function analyzeWithOpenAI(
  screenshotBase64: string,
  prompt: string,
  config: LookerConfig,
): Promise<string> {
  const apiKey = config.analysis?.apiKey ?? process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error('OPENAI_API_KEY not set. Provide via --api-key or environment variable.');
  }

  const client = new OpenAI({
    apiKey,
    baseURL: config.analysis?.apiUrl,
  });
  const model = config.analysis?.model ?? 'gpt-4o';

  const response = await client.chat.completions.create({
    model,
    max_tokens: 4096,
    messages: [
      {
        role: 'user',
        content: [
          {
            type: 'image_url',
            image_url: {
              url: `data:image/png;base64,${screenshotBase64}`,
            },
          },
          {
            type: 'text',
            text: prompt,
          },
        ],
      },
    ],
  });

  return response.choices[0]?.message?.content ?? '';
}

// --- Public API ---

export async function analyzeScreenshot(
  screenshotPath: string,
  url: string,
  viewport: ViewportConfig,
  goals: string[],
  config: LookerConfig,
): Promise<PageAnalysis> {
  const screenshotBuffer = await readFile(screenshotPath);
  const screenshotBase64 = screenshotBuffer.toString('base64');

  // Load custom prompt if specified
  let customPromptText: string | undefined;
  if (config.analysis?.prompt) {
    customPromptText = await readFile(config.analysis.prompt, 'utf-8');
  }

  const prompt = buildPrompt(url, viewport, goals, customPromptText, config.focus);
  const provider = config.analysis?.provider ?? 'claude';

  const raw = await retryWithBackoff(
    async () => {
      if (provider === 'openai') {
        return analyzeWithOpenAI(screenshotBase64, prompt, config);
      }
      return analyzeWithClaude(screenshotBase64, prompt, config);
    },
    {
      attempts: 3,
      onRetry: (err, attempt) => {
        logger.debug(`API retry ${attempt} for ${url} @ ${viewport.name}: ${err}`);
      },
    },
  );

  return parseAnalysisResponse(raw);
}
