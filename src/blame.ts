import { window } from 'vscode';
import { exec } from 'node:child_process';
import { promisify } from 'node:util';
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
        window.showErrorMessage(error.message ?? 'Something went wrong');
      }
    }
  }
  return '';
}

/**
 * Create a new entry if needed
 */
function ensureEntry(entries: BlameResults, hash: string) {
  if (entries[hash] === undefined) {
    entries[hash] = {
      hash,
      lines: [],
      author: '',
      email: '',
      date: 0,
      timeZone: '',
      summary: '',
    };
  }
}

/**
 * Parse `git blame` results into an object (only parse data we actually need)
 * https://git-scm.com/docs/git-blame#_the_porcelain_format
 */
function parseBlameResults(results: string) {
  const lines = results.trim().split('\n');
  const entries: BlameResults = {};

  for (let index = 0; index < lines.length; index++) {
    // Each blame entry always starts with a line of:
    // <40-byte hex sha1> <source line> <result line> [number of lines]
    // Example: 49790775624c422f67057f7bb936f35df920e391 94 120 3
    const header = /^([\da-f]{40})\s(\d+)\s(\d+)\s?(\d+)?$/.exec(lines[index]);

    if (header === null) {
      logMessage('Skip parsing line', lines[index]);
      window.showErrorMessage('Git blame parsing failed.');
      continue;
    }

    const [, hash /* sourceLine */, , resultLine] = header;

    // This is just a line info, not a big info block
    if (
      lines[index + 2] === undefined ||
      /^([\da-f]{40})/.test(lines[index + 2])
    ) {
      // Create a new entry if needed
      ensureEntry(entries, hash);

      // Skip the line with code
      index++;
    } else {
      // We got the the block of commit info

      // Create a new entry if needed
      ensureEntry(entries, hash);

      // Advance to the info block
      index++;

      // Parse info rows
      let info;
      while ((info = lines[index].match(/^([a-z-]+)\s(.+)$/))) {
        const [, key, value] = info;
        switch (key) {
          case 'author': {
            entries[hash].author = value;
            break;
          }
          case 'author-mail': {
            // Remove <...> from email
            entries[hash].email = value.slice(1, -1);
            break;
          }
          case 'author-time': {
            // Convert timestamp from seconds to milliseconds
            entries[hash].date = Number.parseInt(value) * 1000;
            break;
          }
          case 'author-tz': {
            entries[hash].timeZone = value;
            break;
          }
          case 'summary': {
            entries[hash].summary = value;
            break;
          }
        }
        index++;
      }
    }

    // Add line number to the entry
    entries[hash].lines.push(Number.parseInt(resultLine));
  }

  return Object.values(entries);
}

export async function getBlameInfo(
  workspaceRoot: string,
  relativePath: string,
): Promise<BlameEntry[]> {
  logMessage('Relative path:', relativePath);

  const results = await execGitBlame(workspaceRoot, relativePath);

  const parsedResults = parseBlameResults(results);

  return parsedResults;
}
