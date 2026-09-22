import * as vscode from 'vscode';

let channel: vscode.OutputChannel | undefined;

export function getCompilerOutputChannel(): vscode.OutputChannel {
    if (!channel) channel = vscode.window.createOutputChannel('Mercury Compiler');
    return channel;
}

let statusBarItem: vscode.StatusBarItem | undefined;

export function getStatusBarItem(): vscode.StatusBarItem {
    if (!statusBarItem) {
        statusBarItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
        statusBarItem.command = 'mercuryTools.openCompilerOutput';
        statusBarItem.show();
    }
    return statusBarItem;
}

export function setStatusBar(text: string, tooltip: string): void {
    const item = getStatusBarItem();
    item.text = text;
    item.tooltip = tooltip;
}
