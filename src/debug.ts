import { window } from 'vscode';
import packageJson from '../package.json';

const debug = window.createOutputChannel(packageJson.displayName);

/**
 * Log debug message or data
 */
export function logMessage(...messages: unknown[]) {
  debug.appendLine(
    messages
      .map((x) =>
        typeof x === 'string' || typeof x === 'number' ? x : JSON.stringify(x),
      )
      .join(' '),
  );
}
