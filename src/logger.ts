import chalk from 'chalk';
import ora, { type Ora } from 'ora';

let verboseMode = false;
let quietMode = false;
let currentSpinner: Ora | null = null;

export function setVerbose(verbose: boolean): void {
  verboseMode = verbose;
}

export function setQuiet(quiet: boolean): void {
  quietMode = quiet;
}

export function info(message: string): void {
  if (quietMode) return;
  stopSpinner();
  console.log(chalk.blue('ℹ'), message);
}

export function success(message: string): void {
  if (quietMode) return;
  stopSpinner();
  console.log(chalk.green('✓'), message);
}

export function warn(message: string): void {
  stopSpinner();
  console.warn(chalk.yellow('⚠'), message);
}

export function error(message: string): void {
  stopSpinner();
  console.error(chalk.red('✗'), message);
}

export function debug(message: string): void {
  if (!verboseMode) return;
  stopSpinner();
  console.log(chalk.gray('  →'), chalk.gray(message));
}

export function progress(text: string): Ora {
  stopSpinner();
  if (quietMode) {
    // Return a no-op spinner
    currentSpinner = ora({ text, isEnabled: false });
    return currentSpinner;
  }
  currentSpinner = ora(text).start();
  return currentSpinner;
}

export function stopSpinner(): void {
  if (currentSpinner?.isSpinning) {
    currentSpinner.stop();
  }
  currentSpinner = null;
}

export function heading(text: string): void {
  if (quietMode) return;
  stopSpinner();
  console.log();
  console.log(chalk.bold.underline(text));
  console.log();
}

export function goalAlignment(label: string, alignment: 'strong' | 'partial' | 'weak'): string {
  switch (alignment) {
    case 'strong':
      return chalk.green(`● ${label}`);
    case 'partial':
      return chalk.yellow(`◐ ${label}`);
    case 'weak':
      return chalk.red(`○ ${label}`);
  }
}

export function severityColor(severity: 'critical' | 'warning' | 'info'): (text: string) => string {
  switch (severity) {
    case 'critical':
      return chalk.red;
    case 'warning':
      return chalk.yellow;
    case 'info':
      return chalk.blue;
  }
}
