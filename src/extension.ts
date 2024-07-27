import { commands, window, workspace, type ExtensionContext } from 'vscode';
import { logMessage } from './debug';
import { BlameManager } from './BlameManager';
import type { ExtensionProperties } from './types';

function getExtensionProperties(): ExtensionProperties {
  const { colorScale, locale } = workspace.getConfiguration('justBlame');
  return {
    colorScale,
    locale,
  };
}

export function activate(context: ExtensionContext) {
  logMessage('🪲 Just Blame starting...');

  let { activeTextEditor } = window;

  const blame = new BlameManager(getExtensionProperties());

  context.subscriptions.push(
    commands.registerTextEditorCommand('justBlame.toggleBlame', (editor) => {
      blame.toggleBlame(editor);
    }),

    // Close on text change
    workspace.onDidChangeTextDocument(({ document, contentChanges }) => {
      if (
        // Ignore changes that didn't affect text content
        contentChanges.length === 0 ||
        // Ignore changes in other documents
        document !== activeTextEditor?.document ||
        // Ignore output panel
        document.languageId === 'Log'
      ) {
        return;
      }

      blame.closeBlame(activeTextEditor);
    }),

    // Close on document change
    window.onDidChangeActiveTextEditor((editor) => {
      // Ignore switch to log panel and back
      if (
        editor === activeTextEditor ||
        editor?.document.languageId === 'Log'
      ) {
        return;
      }
      if (activeTextEditor) {
        blame.closeBlame(activeTextEditor);
      }
      activeTextEditor = editor;
    }),
  );
}
