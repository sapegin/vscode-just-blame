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

  const blames = new Map<string, BlameManager>();

  context.subscriptions.push(
    // Toggle blame
    commands.registerTextEditorCommand(
      'justBlame.toggleBlame',
      async (editor) => {
        const { fileName } = editor.document;

        if (blames.has(fileName) === false) {
          logMessage('Create new blame instance for', fileName);
          const config = getExtensionProperties();
          logMessage('Config: ', config);
          const blame = new BlameManager(config);
          const isOpen = await blame.open(editor);
          if (isOpen) {
            blames.set(fileName, blame);
          }
        } else {
          logMessage('Destroy blame instance for', fileName);
          blames.get(fileName)?.close(editor);
          blames.delete(fileName);
        }
      },
    ),

    // Close on text change: we cannot show correct blame on unsaved files
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

      const { fileName } = activeTextEditor.document;
      blames.get(fileName)?.close(activeTextEditor);
      blames.delete(fileName);
    }),

    // Update on document change
    window.onDidChangeActiveTextEditor((editor) => {
      if (editor === undefined) {
        return;
      }

      const { fileName } = editor.document;

      if (blames.has(fileName)) {
        // Update the blame for the current editor
        logMessage('Refresh the blame for', fileName);
        blames.get(fileName)?.open(editor);
      }

      activeTextEditor = editor;
    }),
  );
}
