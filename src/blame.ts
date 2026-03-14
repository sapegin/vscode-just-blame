import { exec } from 'node:child_process';
import path from 'node:path';
import { promisify } from 'node:util';
import { window } from 'vscode';
import { logMessage } from './debug';

export const promiseExec = promisify(exec);

export interface BlameEntry {
  hash: string;
  lines: number[];
  author: string;
  email: string;
  date: number;
  timeZone: string;
  summary: string;
}

type BlameResults = Record<string, BlameEntry>;

/**
 * Run `git blame`
 * https://git-scm.com/docs/git-blame
 */
async function execGitBlame(workspaceRoot: string, relativePath: string) {
  const command = `git --no-pager blame --porcelain "${relativePath}"`;
  logMessage('Running git blame:', command);

  try {
    const { stdout } = await promiseExec(command, {
      cwd: workspaceRoot,
    });
    return stdout;
  } catch (error) {
    logMessage('Blame returned an error:', error);

    if (error instanceof Error) {
      if (error.message.includes('git: not found')) {
        window.showErrorMessage(
          'Git not found. Make sure Git is installed and available in the PATH',
        );
      } else {
        window.showErrorMessage(error.message);
      }
    }
  }
  return '';
}

/**
 * Create a new entry if needed, returns the existing or new entry.
 */
function ensureEntry(entries: BlameResults, hash: string) {
  entries[hash] ??= {
    hash,
    lines: [],
    author: '',
    email: '',
    date: 0,
    timeZone: '',
    summary: '',
  };
  return entries[hash];
}

/**
 * Parse `git blame` results into an object (only parse data we actually need)
 * https://git-scm.com/docs/git-blame#_the_porcelain_format
 */
function parseBlameResults(results: string) {
  const lines = results.trim().split('\n');
  const entries: BlameResults = {};

  for (let index = 0; index < lines.length; index++) {
    const line = lines[index];
    if (line === undefined) {
      continue;
    }

    // Each blame entry always starts with a line of:
    // <40-byte hex sha1> <source line> <result line> [number of lines]
    // Example: 49790775624c422f67057f7bb936f35df920e391 94 120 3
    const header = /^([\da-f]{40})\s(\d+)\s(\d+)\s?(\d+)?$/.exec(line);

    if (header === null) {
      logMessage('Skip parsing line', index, line);
      window.showErrorMessage('Git blame parsing failed.');
      continue;
    }

    const [, hash /* sourceLine */, , resultLine] = header;
    if (hash === undefined || resultLine === undefined) {
      continue;
    }

    // Create a new entry if needed
    const entry = ensureEntry(entries, hash);

    // This is just a line info, not a big info block
    if (
      lines[index + 2] === undefined ||
      /^([\da-f]{40})/.test(lines[index + 2] ?? '')
    ) {
      // Skip the line with code
      index++;
    } else {
      // We got the the block of commit info

      // Advance to the info block
      index++;

      // Parse info rows
      // Info rows are either `some-name Value` or `boundary`
      // The last info row is always `filename`
      let info;
      while ((info = lines[index]?.match(/^([a-z-]+)\s(.+)$/))) {
        const [, key, value] = info;
        if (value === undefined) {
          break;
        }

        switch (key) {
          case 'author': {
            entry.author = value;
            break;
          }
          case 'author-mail': {
            // Remove <...> from email
            entry.email = value.slice(1, -1);
            break;
          }
          case 'author-time': {
            // Convert timestamp from seconds to milliseconds
            entry.date = Number.parseInt(value) * 1000;
            break;
          }
          case 'author-tz': {
            entry.timeZone = value;
            break;
          }
          case 'summary': {
            entry.summary = value;
            break;
          }
        }
        index++;
      }
    }

    // Add line number to the entry
    entry.lines.push(Number.parseInt(resultLine));
  }

  return Object.values(entries);
}

/**
 * Resolve the git repository root for a given file path.
 * Falls back to the provided workspaceRoot when git is unavailable.
 */
export async function getGitRoot(
  filePath: string,
  fallback: string,
): Promise<string> {
  try {
    const { stdout } = await promiseExec('git rev-parse --show-toplevel', {
      cwd: path.dirname(filePath),
    });
    return stdout.trim();
  } catch {
    return fallback;
  }
}

export async function getBlameInfo(
  gitRoot: string,
  relativePath: string,
): Promise<BlameEntry[]> {
  logMessage('Relative path:', relativePath);

  const results = await execGitBlame(gitRoot, relativePath);

  const parsedResults = parseBlameResults(results);

  return parsedResults;
}
