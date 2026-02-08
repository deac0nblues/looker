import { z } from 'zod';

// --- Viewport ---

export const ViewportConfigSchema = z.object({
  name: z.string(),
  width: z.number().int().positive(),
  height: z.number().int().positive(),
});
export type ViewportConfig = z.infer<typeof ViewportConfigSchema>;

export const DEFAULT_VIEWPORTS: ViewportConfig[] = [
  { name: 'mobile', width: 375, height: 812 },
  { name: 'tablet', width: 768, height: 1024 },
  { name: 'desktop', width: 1440, height: 900 },
  { name: 'wide', width: 1920, height: 1080 },
];

// --- Capture Options ---

export const CaptureOptionsSchema = z.object({
  delay: z.number().int().nonnegative().optional(),
  waitFor: z.string().optional(),
  hideSelectors: z.array(z.string()).optional(),
  noAnimations: z.boolean().optional(),
  darkMode: z.boolean().optional(),
  timeout: z.number().int().positive().optional(),
  scrollReveal: z.boolean().optional(),
});
export type CaptureOptions = z.infer<typeof CaptureOptionsSchema>;

// --- Auth ---

export const AuthConfigSchema = z.object({
  cookies: z
    .array(
      z.object({
        name: z.string(),
        value: z.string(),
        domain: z.string(),
        path: z.string().optional(),
      }),
    )
    .optional(),
  localStorage: z.record(z.string()).optional(),
});
export type AuthConfig = z.infer<typeof AuthConfigSchema>;

// --- Analysis / Model ---

export const ModelProviderSchema = z.enum(['claude', 'openai']);
export type ModelProvider = z.infer<typeof ModelProviderSchema>;

export const AnalysisConfigSchema = z.object({
  model: z.string().optional(),
  provider: ModelProviderSchema.optional(),
  apiKey: z.string().optional(),
  apiUrl: z.string().url().optional(),
  prompt: z.string().optional(),
  focus: z.string().optional(),
});
export type AnalysisConfig = z.infer<typeof AnalysisConfigSchema>;

// --- Goals ---

export interface VisualGoal {
  scope: 'site-wide' | string; // 'site-wide' or page path like '/pricing'
  goals: string[];
}

export const GoalAssessmentSchema = z.object({
  goal: z.string(),
  alignment: z.enum(['strong', 'partial', 'weak']),
  observation: z.string(),
  gap: z.string().nullable(),
  suggestion: z.string().nullable(),
});
export type GoalAssessment = z.infer<typeof GoalAssessmentSchema>;

// --- Issues ---

export const IssueSeveritySchema = z.enum(['critical', 'warning', 'info']);
export type IssueSeverity = z.infer<typeof IssueSeveritySchema>;

export const IssueCategorySchema = z.enum([
  'layout',
  'typography',
  'color',
  'responsiveness',
  'polish',
  'accessibility',
  'goal-alignment',
  'other',
]);
export type IssueCategory = z.infer<typeof IssueCategorySchema>;

export const IssueSchema = z.object({
  severity: IssueSeveritySchema,
  category: IssueCategorySchema,
  description: z.string(),
  element: z.string().nullable(),
});
export type Issue = z.infer<typeof IssueSchema>;

// --- Analysis Result ---

export const DesignFeedbackSchema = z.object({
  layoutAndHierarchy: z.string(),
  typography: z.string(),
  colorAndContrast: z.string(),
  responsiveness: z.string(),
  visualPolish: z.string(),
});
export type DesignFeedback = z.infer<typeof DesignFeedbackSchema>;

export const PageAnalysisSchema = z.object({
  feedback: DesignFeedbackSchema,
  issues: z.array(IssueSchema),
  goalAssessments: z.array(GoalAssessmentSchema),
  overallGoalAlignment: z.number().min(0).max(100).nullable(),
  topRecommendations: z.array(z.string()),
  rawResponse: z.string().optional(),
});
export type PageAnalysis = z.infer<typeof PageAnalysisSchema>;

// --- Cross-Viewport Comparison ---

export const CrossViewportAnalysisSchema = z.object({
  breakpointQuality: z.string(),
  contentParity: z.string(),
  navigationAdaptation: z.string(),
  consistencyAcrossSizes: z.string(),
  goalConsistency: z.string().nullable(),
  issues: z.array(IssueSchema),
  rawResponse: z.string().optional(),
});
export type CrossViewportAnalysis = z.infer<typeof CrossViewportAnalysisSchema>;

// --- Screenshot Manifest ---

export interface ScreenshotEntry {
  url: string;
  viewport: ViewportConfig;
  filePath: string;
  timestamp: number;
  cached: boolean;
}

// --- Page Result ---

export interface PageResult {
  url: string;
  screenshots: Map<string, ScreenshotEntry>; // viewport name -> entry
  analyses: Map<string, PageAnalysis>; // viewport name -> analysis
  crossViewportAnalysis: CrossViewportAnalysis | null;
  errors: Array<{ viewport: string; error: string }>;
}

// --- Report ---

export type ReportFormat = 'console' | 'markdown' | 'html' | 'json';

// --- Run Result ---

export interface RunResult {
  pages: PageResult[];
  summary: {
    pagesAnalyzed: number;
    viewports: string[];
    totalIssues: { critical: number; warning: number; info: number };
    averageGoalAlignment: number | null;
  };
  exitCode: 0 | 1 | 2;
}

// --- Config ---

export const LookerConfigSchema = z.object({
  // Input
  url: z.string().url().optional(),
  sitemap: z.string().url().optional(),
  urls: z.string().optional(), // file path
  maxPages: z.number().int().positive().optional(),
  include: z.string().optional(),
  exclude: z.string().optional(),

  // Viewports
  viewports: z.array(ViewportConfigSchema).optional(),

  // Capture
  capture: CaptureOptionsSchema.optional(),
  auth: z.string().optional(), // path to auth JSON file

  // Goals
  goals: z.string().optional(), // path to goals file

  // Analysis
  analysis: AnalysisConfigSchema.optional(),

  // Output
  output: z.enum(['console', 'markdown', 'html', 'json']).optional(),
  outputFile: z.string().optional(),

  // Cache
  noCache: z.boolean().optional(),
  cacheDir: z.string().optional(),
  reanalyze: z.boolean().optional(),

  // CI
  failOn: IssueSeveritySchema.optional(),
  baseline: z.string().optional(),

  // Pages (from config file)
  pages: z.array(z.string()).optional(),
  hide: z.array(z.string()).optional(),
  focus: z.string().optional(),

  // Discovery
  noDiscover: z.boolean().optional(),
});
export type LookerConfig = z.infer<typeof LookerConfigSchema>;

export const DEFAULT_URL = 'https://websiteqsltemp.vercel.app/';
export const DEFAULT_MAX_PAGES = 10;
export const DEFAULT_MODEL = 'claude-sonnet-4-20250514';
export const DEFAULT_TIMEOUT = 30000;
export const DEFAULT_CONCURRENCY = 3;
