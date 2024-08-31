import isEmpty from 'lodash/isEmpty';
import maxBy from 'lodash/maxBy';
import uniq from 'lodash/uniq';
import gitRemoteOriginUrl from 'git-remote-origin-url';
import { getBlameInfo, type BlameEntry } from './blame';
import { logMessage } from './debug';
import {
  ColorThemeKind,
  MarkdownString,
  Position,
  Range,
  ThemeColor,
  window,
  workspace,
  type DecorationOptions,
  type TextDocument,
  type TextEditor,
  type TextEditorDecorationType,
  type ThemableDecorationAttachmentRenderOptions,
} from 'vscode';
import type { ExtensionProperties } from './types';

/** Color to use for entries that are older than the last available color in the scale */
const NO_COLOR = '#fff0';

/** Non-breaking space: has the correct width but doesn’t get squished like a regular space */
const NBSP = '\u00A0';
/** Narrower space */
const THIN_SPACE = '\u2009';

/** Git blame returns this for new, uncommitted lines */
const UNCOMMITTED_AUTHOR = 'Not Committed Yet';
/** Label to show for uncommitted changes */
const UNCOMMITTED_LABEL = 'Not committed';

export class BlameManager {
  private config: ExtensionProperties;
  private blameResults: BlameEntry[] = [];
  private colorMap: Record<string, string> = {};
  private decorationType: TextEditorDecorationType;

  public constructor(config: ExtensionProperties) {
    this.config = config;
    this.decorationType = window.createTextEditorDecorationType({
      before: {
        color: new ThemeColor('editor.foreground'),
        height: 'editor.lineHeight',
        margin: '0 0.5em 0 0',
      },
    });
  }

  public async open(editor: TextEditor) {
    const workspaceRoot = this.getWorkspaceRoot(editor);
    if (workspaceRoot === undefined) {
      window.showErrorMessage('Workspace is required to use Just Blame');
      return;
    }

    logMessage('Workspace root:', workspaceRoot);

    const relativePath = workspace.asRelativePath(editor.document.uri);
    this.blameResults = await getBlameInfo(workspaceRoot, relativePath);

    if (isEmpty(this.blameResults)) {
      logMessage('Empty blame');
      // No results (possibly an error): do nothing, pretend the blame was never opened
      return;
    }

    this.indexColors(this.blameResults);

    const repoUrl = await this.getRepositoryUrl(workspaceRoot);

    logMessage('GitHub URL', repoUrl);

    const decorations = this.getBlamedDecorations(editor.document, repoUrl);
    editor.setDecorations(this.decorationType, decorations);
  }

  public close(editor: TextEditor) {
    // Remove all decorations
    editor.setDecorations(this.decorationType, []);
  }

  private indexColors(blameResults: BlameEntry[]) {
    const colorScale = this.getColorScale();
    const allDates = blameResults.map((x) => x.date);
    const distinctDates = uniq(allDates);
    const sortedDistinctDates = distinctDates.toSorted((a, b) => b - a);
    this.colorMap = sortedDistinctDates.reduce<Record<string, string>>(
      (accumulator, date, index) => {
        if (index < colorScale.length) {
          accumulator[date] = colorScale[index];
        }
        return accumulator;
      },
      {},
    );
  }

  private getWorkspaceRoot(editor: TextEditor) {
    return workspace.getWorkspaceFolder(editor.document.uri)?.uri.fsPath;
  }

  private async getRepositoryUrl(gitRoot: string) {
    const remote = await gitRemoteOriginUrl({ cwd: gitRoot });

    if (remote.startsWith('https://github.com/')) {
      // https://github.com/sapegin/taco-cat.git
      return remote.replace(/\.git$/, '');
    }

    if (remote.startsWith('git@github.com:')) {
      // git@github.com:sapegin/taco-cat.git
      return remote
        .replace(/^git@github.com:/, 'https://github.com/')
        .replace(/\.git$/, '');
    }

    return remote;
  }

  /**
   * Monday, 17 June 2024 at 14:04:31 GMT+2
   */
  private formatDateLong(date: number, timeZone: string) {
    return new Intl.DateTimeFormat(this.config.locale, {
      dateStyle: 'full',
      timeStyle: 'long',
      timeZone,
    }).format(new Date(date));
  }

  /**
   * 30.05.99
   */
  private formatDateShort(date: number) {
    return new Intl.DateTimeFormat(this.config.locale, {
      day: '2-digit',
      month: '2-digit',
      year: '2-digit',
    }).format(new Date(date));
  }

  private getColorScale() {
    const themeKind = window.activeColorTheme.kind;
    return this.config.colorScale[
      themeKind === ColorThemeKind.Light ? 'light' : 'dark'
    ];
  }

  private getColorForDate(date: number) {
    return this.colorMap[date] ?? NO_COLOR;
  }

  private getAnnotationText(
    author: string,
    date: number,
    maxAuthorLength: number,
  ) {
    return [
      THIN_SPACE,
      this.formatDateShort(date),
      ' ',
      author.padEnd(maxAuthorLength, NBSP),
      THIN_SPACE,
    ].join('');
  }

  private getTooltipText(
    { hash, author, email, date, timeZone, summary }: BlameEntry,
    repoUrl: string,
  ) {
    const hashLink = repoUrl ? `[${hash}](${repoUrl}/commit/${hash})` : hash;
    return `
**Commit:** ${hashLink}<br>
**Author:** ${author} <<${email}>><br>
**Date:** ${this.formatDateLong(date, timeZone)}

${summary}
`;
  }

  private getBlameInfoForLine(lineNumber: number) {
    return this.blameResults.find((x) => x.lines.includes(lineNumber));
  }

  private getBlamedDecorations(document: TextDocument, repoUrl: string) {
    const decorations: DecorationOptions[] = [];

    const lineCount = document.lineCount ?? 0;

    // Longest author lengths to align columns
    const maxAuthorLength = Math.max(
      ...this.blameResults.map((line) => line.author.length),
    );

    // Latest commit, but skip uncommitted lines
    const latestCommit = maxBy(this.blameResults, (x) =>
      x.author === UNCOMMITTED_AUTHOR ? 0 : x.date,
    )?.hash;

    for (let index = 1; index < lineCount; index++) {
      const blame = this.getBlameInfoForLine(index);
      if (blame === undefined) {
        continue;
      }

      const startPos = new Position(index - 1, 0);
      const endPos = new Position(index - 1, 0);
      const range = new Range(startPos, endPos);

      const isNotCommittedYet = blame.author === UNCOMMITTED_AUTHOR;
      const isLastCommit =
        isNotCommittedYet === false && blame.hash === latestCommit;

      const decorationOptions: ThemableDecorationAttachmentRenderOptions = {
        contentText: this.getAnnotationText(
          isNotCommittedYet ? UNCOMMITTED_LABEL : blame.author,
          blame.date,
          maxAuthorLength,
        ),
        backgroundColor: this.getColorForDate(blame.date),
        fontStyle: isNotCommittedYet ? 'italic' : 'normal',
        fontWeight: isLastCommit ? 'bold' : 'normal',
      };

      const hoverMarkdown = new MarkdownString(
        this.getTooltipText(blame, repoUrl),
      );
      hoverMarkdown.supportHtml = true;

      decorations.push({
        range,
        renderOptions: {
          before: decorationOptions,
        },
        hoverMessage: isNotCommittedYet ? undefined : hoverMarkdown,
      });
    }

    return decorations;
  }
}
