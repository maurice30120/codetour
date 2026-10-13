/**
 * A minimal in-memory VS Code host used to exercise the compiled extension
 * code at the level of its public commands, without a running editor.
 *
 * The mock is deliberately small: it implements only the VS Code API surface
 * the player modules touch, and records every observable effect (comment
 * threads, webview panels, decorations, revealed documents, commands) so
 * tests can assert on behavior rather than on internal state.
 */

export interface UriComponents {
  scheme?: string;
  authority?: string;
  path?: string;
  query?: string;
  fragment?: string;
}

export class Uri {
  constructor(
    readonly scheme: string,
    readonly authority: string = "",
    readonly path: string = "",
    readonly query: string = "",
    readonly fragment: string = ""
  ) {}

  get fsPath(): string {
    return this.path;
  }

  toString(): string {
    const authority = this.authority ? `//${this.authority}` : "";
    const query = this.query ? `?${this.query}` : "";
    const fragment = this.fragment ? `#${this.fragment}` : "";
    return `${this.scheme}:${authority}${this.path}${query}${fragment}`;
  }

  with(components: UriComponents): Uri {
    return new Uri(
      components.scheme ?? this.scheme,
      components.authority ?? this.authority,
      components.path ?? this.path,
      components.query ?? this.query,
      components.fragment ?? this.fragment
    );
  }

  static from(components: UriComponents): Uri {
    return new Uri(
      components.scheme || "",
      components.authority,
      components.path,
      components.query,
      components.fragment
    );
  }

  static file(path: string): Uri {
    return new Uri("file", "", path);
  }

  static parse(value: string, _strict?: boolean): Uri {
    const match = value.match(
      /^([a-zA-Z][\w+.-]*):(\/\/([^\/]*))?([^?#]*)(\?[^#]*)?(#.*)?$/
    );
    if (!match) {
      return new Uri("file", "", value);
    }

    return new Uri(
      match[1],
      match[3] || "",
      match[4] || "",
      (match[5] || "").slice(1),
      (match[6] || "").slice(1)
    );
  }

  static joinPath(base: Uri, ...segments: string[]): Uri {
    const path = [base.path, ...segments]
      .join("/")
      .replace(/\/{2,}/g, "/")
      .replace(/\/\.(?=\/|$)/g, "")
      .replace(/\/$/, "");
    return new Uri(base.scheme, base.authority, path, base.query, base.fragment);
  }
}

export class Position {
  constructor(readonly line: number, readonly character: number) {}
}

export class Range {
  readonly start: Position;
  readonly end: Position;

  constructor(start: Position, end: Position);
  constructor(startLine: number, startCharacter: number, endLine: number, endCharacter: number);
  constructor(
    start: Position | number,
    endOrCharacter: Position | number,
    endLine?: number,
    endCharacter?: number
  ) {
    if (start instanceof Position) {
      this.start = start;
      this.end = endOrCharacter as Position;
    } else {
      this.start = new Position(start, endOrCharacter as number);
      this.end = new Position(endLine!, endCharacter!);
    }
  }
}

export class Selection extends Range {
  constructor(
    startLine: number | Position,
    startCharacter: number | Position,
    endLine?: number,
    endCharacter?: number
  ) {
    if (startLine instanceof Position) {
      super(startLine, startCharacter as Position);
    } else {
      super(startLine, startCharacter as number, endLine!, endCharacter!);
    }
  }
}

export class MarkdownString {
  isTrusted?: boolean;
  supportThemeIcons?: boolean;
  constructor(public value: string = "") {}
}

export class ThemeColor {
  constructor(readonly id: string) {}
}

export class ThemeIcon {
  constructor(readonly id: string, public color?: ThemeColor) {}
}

export class TreeItem {
  label?: string;
  description?: string;
  tooltip?: string;
  iconPath?: unknown;
  contextValue?: string;
  command?: { command: string; title: string; arguments?: unknown[] };
  resourceUri?: Uri;
  constructor(label?: string, public collapsibleState?: number) {
    this.label = label;
  }
}

export class Disposable {
  constructor(private readonly callback: () => void = () => {}) {}
  dispose(): void {
    this.callback();
  }
}

export class EventEmitter<T> {
  private listeners = new Set<(event: T) => unknown>();

  readonly event = (listener: (event: T) => unknown): Disposable => {
    this.listeners.add(listener);
    return new Disposable(() => this.listeners.delete(listener));
  };

  fire(event: T): void {
    this.listeners.forEach(listener => listener(event));
  }

  dispose(): void {
    this.listeners.clear();
  }
}

export class FileSystemError extends Error {
  code: string;
  constructor(message: string) {
    super(message);
    this.code = message;
  }
  static FileNotFound(): FileSystemError {
    return new FileSystemError("FileNotFound");
  }
  static FileExists(): FileSystemError {
    return new FileSystemError("FileExists");
  }
}

export const ViewColumn = {
  Active: -1,
  Beside: -2,
  One: 1,
  Two: 2,
  Three: 3,
  Four: 4,
  Five: 5,
  Six: 6,
  Seven: 7,
  Eight: 8,
  Nine: 9
} as const;

export const CommentMode = { Editing: 1, Preview: 2 } as const;
export const CommentThreadCollapsibleState = { Collapsed: 0, Expanded: 1 } as const;
export const OverviewRulerLane = { Left: 1, Center: 2, Right: 4 } as const;
export const ConfigurationTarget = {
  Global: 1,
  Workspace: 2,
  WorkspaceFolder: 3
} as const;
export const ColorThemeKind = { Light: 1, Dark: 2, HighContrast: 3 } as const;
export const TextEditorRevealType = {
  Default: 0,
  InCenter: 1,
  InCenterIfOutsideViewport: 2,
  AtTop: 3
} as const;
export const StatusBarAlignment = { Left: 1, Right: 2 } as const;
export const TreeItemCollapsibleState = { None: 0, Collapsed: 1, Expanded: 2 } as const;
export const DecorationRangeBehavior = {
  OpenOpen: 1,
  ClosedClosed: 2,
  OpenClosed: 3,
  ClosedOpen: 4
} as const;
export const FileType = { File: 1, Directory: 2, SymbolicLink: 64 } as const;

export interface TextDocument {
  uri: Uri;
  getText(): string;
  get lineCount(): number;
  positionAt(offset: number): Position;
  lineAt(line: number): { text: string; range: Range };
  save(): Promise<boolean>;
}

export interface TextEditorDecorationType {
  readonly options: Record<string, unknown>;
  dispose(): void;
}

export interface CommentThread {
  uri: Uri;
  range: Range;
  comments: { body: MarkdownString; label?: string; mode?: number }[];
  contextValue: string;
  collapsibleState: number;
  canReply: boolean;
  disposed: boolean;
  dispose(): void;
}

export interface CommentController {
  readonly threads: CommentThread[];
  disposed: boolean;
  commentingRangeProvider?: unknown;
  createCommentThread(uri: Uri, range: Range, comments: unknown[]): CommentThread;
  dispose(): void;
}

export interface WebviewPanel {
  viewType: string;
  title: string;
  webview: {
    html: string;
    onDidReceiveMessage(listener: (message: unknown) => void): Disposable;
    // Delivers a host-to-webview message, recorded so tests can assert what
    // the extension sent to the panel (e.g. the rendered draft preview).
    postMessage(message: unknown): boolean;
  };
  disposed: boolean;
  revealed: boolean;
  onDidDispose(listener: () => void): Disposable;
  reveal(viewColumn?: number, preserveFocus?: boolean): void;
  dispose(): void;
  receive(message: unknown): void;
}
class MockTextDocument implements TextDocument {
  constructor(readonly uri: Uri, private text: string) {}

  getText(): string {
    return this.text;
  }

  get lineCount(): number {
    return this.text.split("\n").length;
  }

  positionAt(offset: number): Position {
    const before = this.text.slice(0, offset);
    const lines = before.split("\n");
    return new Position(lines.length - 1, lines[lines.length - 1].length);
  }

  lineAt(line: number): { text: string; range: Range } {
    const lines = this.text.split("\n");
    return {
      text: lines[line] ?? "",
      range: new Range(line, 0, line, (lines[line] ?? "").length)
    };
  }

  async save(): Promise<boolean> {
    return true;
  }

  replace(text: string): void {
    this.text = text;
  }
}

class MockTextEditor {
  selection = new Selection(0, 0, 0, 0);
  readonly revealedRanges: Range[] = [];
  readonly decorations = new Map<TextEditorDecorationType, Range[]>();

  constructor(
    readonly document: MockTextDocument,
    readonly viewColumn: number = ViewColumn.One
  ) {}

  setDecorations(type: TextEditorDecorationType, ranges: Range[]): void {
    this.decorations.set(type, ranges);
  }

  revealRange(range: Range, _revealType?: number): void {
    this.revealedRanges.push(range);
  }

  async edit(callback: (editBuilder: {
    insert: (position: Position, text: string) => void;
    replace: (selection: Range, text: string) => void;
  }) => void): Promise<boolean> {
    callback({
      insert: () => undefined,
      replace: () => undefined
    });
    return true;
  }

  hide(): void {}
}

export type TextEditor = MockTextEditor;

export interface GitObjectMock {
  mode?: string;
  content?: string;
}

// A minimal vscode.git API mock. Objects are keyed by `${ref}:${fsPath}`;
// a missing object behaves like Git's UnknownPath error. `delayMs` makes
// repository calls observable-slow so tests can interleave with in-flight
// step resolutions.
export interface GitMockOptions {
  branch?: string;
  head?: string;
  commits?: string[];
  objects?: Record<string, GitObjectMock>;
  delayMs?: number;
}

export interface HostOptions {
  configuration?: Record<string, Record<string, unknown>>;
  git?: GitMockOptions;
  // When true, opening a file-scheme document whose path was never seeded
  // fails like a missing file instead of resolving to an empty document.
  failMissingFiles?: boolean;
  // Paths whose workspace.fs.writeFile rejects, to exercise save failures.
  failingWritesTo?: string[];
}

export function createVscodeHost(options: HostOptions = {}) {
  const configuration = new Map<string, Map<string, unknown>>();
  for (const [section, values] of Object.entries(
    options.configuration ?? {}
  )) {
    configuration.set(section, new Map(Object.entries(values)));
  }

  const contexts = new Map<string, unknown>();
  const commands = new Map<string, (...args: unknown[]) => unknown>();
  const executedCommands: [string, unknown[]][] = [];
  const configurationUpdates: [string, string, unknown, number][] = [];
  const fileWrites: [string, string][] = [];
  const messages: string[] = [];
  const externalLinks: Uri[] = [];
  const documents = new Map<string, MockTextDocument>();
  const files = new Map<string, string>();
  const visibleTextEditors: MockTextEditor[] = [];
  const decorationTypes: TextEditorDecorationType[] = [];
  const commentControllers: MockCommentController[] = [];
  const panels: MockWebviewPanel[] = [];
  const onDidChangeActiveTextEditor = new EventEmitter<TextEditor | undefined>();
  const onDidChangeVisibleTextEditors = new EventEmitter<TextEditor[]>();
  const onDidChangeActiveColorTheme = new EventEmitter<unknown>();
  const failingWrites = new Set(options.failingWritesTo ?? []);

  const rootUri = Uri.file("/workspace");

  const gitOptions = options.git;
  const gitDelay = () =>
    gitOptions?.delayMs
      ? new Promise(resolve => setTimeout(resolve, gitOptions.delayMs))
      : Promise.resolve();
  const gitRepository = {
    state: {
      HEAD: {
        type: 0,
        name: gitOptions?.branch,
        commit: gitOptions?.head
      },
      refs: []
    },
    async getCommit(ref: string) {
      await gitDelay();
      if (!gitOptions?.commits?.includes(ref)) {
        throw new Error(`Unknown commit: ${ref}`);
      }
      return { hash: ref };
    },
    async getObjectDetails(ref: string, path: string) {
      await gitDelay();
      const object = gitOptions?.objects?.[`${ref}:${path}`];
      if (!object) {
        const error = new Error(
          `Unknown path: ${ref}:${path}`
        ) as Error & { gitErrorCode?: string };
        error.gitErrorCode = "UnknownPath";
        throw error;
      }
      return {
        mode: object.mode ?? "100644",
        object: "0000000000000000000000000000000000000000",
        size: 0
      };
    }
  };
  const gitApi = {
    toGitUri: (uri: Uri, ref: string) =>
      Uri.from({
        scheme: "git",
        path: uri.path,
        query: JSON.stringify({ path: uri.path, ref })
      }),
    getRepository: (uri: Uri) => (uri.scheme === "file" ? gitRepository : null)
  };

  function getConfigurationMap(section: string): Map<string, unknown> {
    if (!configuration.has(section)) {
      configuration.set(section, new Map());
    }
    return configuration.get(section)!;
  }

  function setFileContent(path: string, text: string): void {
    files.set(path, text);
    files.set(rootUri.path + "/" + path.replace(/^\//, ""), text);
  }

  function getFilePath(uri: Uri): string {
    if (files.has(uri.path)) {
      return uri.path;
    }
    const relative = uri.path.startsWith(rootUri.path + "/")
      ? uri.path.slice(rootUri.path.length + 1)
      : uri.path;
    return relative;
  }

  function openTextDocument(uri: Uri): Promise<MockTextDocument> {
    const key = uri.toString();
    if (!documents.has(key)) {
      const scheme = uri.scheme;
      const path = getFilePath(uri);
      if (scheme === "file" && files.has(path)) {
        documents.set(key, new MockTextDocument(uri, files.get(path)!));
      } else if (scheme === "file") {
        if (options.failMissingFiles) {
          return Promise.reject(new Error(`File not found: ${key}`));
        }
        documents.set(key, new MockTextDocument(uri, ""));
      } else if (
        scheme === "codetour" ||
        scheme === "codetour-content"
      ) {
        documents.set(key, new MockTextDocument(uri, ""));
      } else if (scheme === "git") {
        let text = "";
        try {
          const parsed = JSON.parse(uri.query) as {
            path?: string;
            ref?: string;
          };
          text =
            gitOptions?.objects?.[`${parsed.ref}:${parsed.path}`]?.content ??
            "";
        } catch {
          text = "";
        }
        documents.set(key, new MockTextDocument(uri, text));
      } else {
        throw new Error(`Cannot open document: ${key}`);
      }
    }
    return Promise.resolve(documents.get(key)!);
  }

  async function showTextDocument(uri: Uri): Promise<MockTextEditor> {
    const document = await openTextDocument(uri);
    const existing = visibleTextEditors.find(
      editor => editor.document.uri.toString() === uri.toString()
    );
    if (existing) {
      return existing;
    }

    const editor = new MockTextEditor(document);
    visibleTextEditors.push(editor);
    return editor;
  }

  class MockCommentThread implements CommentThread {
    comments: { body: MarkdownString; label?: string; mode?: number }[] = [];
    contextValue = "";
    collapsibleState = 0;
    canReply = true;
    disposed = false;

    constructor(
      readonly uri: Uri,
      readonly range: Range,
      comments: unknown[]
    ) {
      this.comments = comments as CommentThread["comments"];
    }

    dispose(): void {
      this.disposed = true;
    }
  }

  class MockCommentController implements CommentController {
    readonly threads: MockCommentThread[] = [];
    disposed = false;
    commentingRangeProvider?: unknown;

    constructor(readonly id: string, readonly label: string) {}

    createCommentThread(
      uri: Uri,
      range: Range,
      comments: unknown[]
    ): MockCommentThread {
      const thread = new MockCommentThread(uri, range, comments);
      this.threads.push(thread);
      return thread;
    }

    dispose(): void {
      this.disposed = true;
      this.threads.forEach(thread => {
        thread.disposed = true;
      });
    }
  }

  class MockWebviewPanel implements WebviewPanel {
    disposed = false;
    revealed = false;
    readonly postedMessages: unknown[] = [];
    webview: WebviewPanel["webview"];
    private readonly onDidDisposeEmitter = new EventEmitter<void>();
    private readonly onDidReceiveMessageEmitter = new EventEmitter<unknown>();

    constructor(
      readonly viewType: string,
      public title: string,
      readonly showOptions: unknown,
      readonly options: unknown
    ) {
      const emitter = this.onDidReceiveMessageEmitter;
      const posted = this.postedMessages;
      this.webview = {
        html: "",
        onDidReceiveMessage: (listener: (message: unknown) => void) =>
          emitter.event(listener),
        postMessage: (message: unknown) => {
          posted.push(message);
          return true;
        }
      };
    }

    onDidDispose(listener: () => void): Disposable {
      return this.onDidDisposeEmitter.event(listener);
    }

    reveal(_viewColumn?: number, _preserveFocus?: boolean): void {
      this.revealed = true;
    }

    dispose(): void {
      if (!this.disposed) {
        this.disposed = true;
        this.onDidDisposeEmitter.fire();
      }
    }

    receive(message: unknown): void {
      this.onDidReceiveMessageEmitter.fire(message);
    }
  }

  let panelCounter = 0;
  function createWebviewPanel(
    viewType: string,
    title: string,
    showOptions: unknown,
    panelOptions: unknown
  ): MockWebviewPanel {
    panelCounter++;
    const panel = new MockWebviewPanel(
      viewType,
      title,
      showOptions,
      panelOptions
    );
    panels.push(panel);
    return panel;
  }

  class MockStatusBarItem {
    text = "";
    command?: string;
    color?: ThemeColor;
    show(): void {}
    hide(): void {}
    dispose(): void {}
  }

  class MockTreeView {
    visible = false;
    revealedItems: unknown[] = [];
    onDidChangeVisibility(): Disposable {
      return new Disposable();
    }
    reveal(item: unknown): void {
      this.revealedItems.push(item);
    }
    dispose(): void {}
  }

  const memento = new Map<string, unknown>();
  const globalState = {
    get: (key: string) => memento.get(key),
    update: async (key: string, value: unknown) => {
      memento.set(key, value);
    },
    setKeysForSync: (_keys: string[]) => undefined
  };

  const extensionContext = {
    extensionPath: "/workspace/.vscode/extensions/codetour",
    extensionUri: Uri.file("/workspace/.vscode/extensions/codetour"),
    globalState,
    workspaceState: globalState,
    subscriptions: [] as Disposable[],
    asAbsolutePath: (path: string) => `/workspace/${path}`
  };

  const workspace = {
    workspaceFolders: [{ uri: rootUri, name: "workspace", index: 0 }],
    workspaceFile: undefined,
    getWorkspaceFolder: (_uri: Uri) => ({ uri: rootUri, name: "workspace", index: 0 }),
    getConfiguration: (section: string) => ({
      get: (key: string, defaultValue?: unknown) => {
        const values = getConfigurationMap(section);
        return values.has(key) ? values.get(key) : defaultValue;
      },
      update: async (key: string, value: unknown, target: number) => {
        getConfigurationMap(section).set(key, value);
        configurationUpdates.push([section, key, value, target]);
      },
      has: (key: string) => getConfigurationMap(section).has(key),
      inspect: (key: string) => ({
        key,
        globalValue: getConfigurationMap(section).get(key)
      })
    }),
    openTextDocument: (uri: Uri) => openTextDocument(uri),
    showTextDocument: (uri: Uri) => showTextDocument(uri),
    registerTextDocumentContentProvider: (_scheme: string, _provider: unknown) =>
      new Disposable(),
    registerFileSystemProvider: (_scheme: string, _provider: unknown) =>
      new Disposable(),
    onDidChangeConfiguration: () => new Disposable(),
    onDidSaveTextDocument: () => new Disposable(),
    findFiles: async () => [],
    fs: {
      writeFile: async (uri: Uri, content: Uint8Array) => {
        if (failingWrites.has(uri.path)) {
          throw new Error(`Write failed: ${uri.path}`);
        }
        const text = new TextDecoder().decode(content);
        fileWrites.push([uri.path, text]);
        files.set(uri.path, text);
      },
      readFile: async (uri: Uri) =>
        new TextEncoder().encode(files.get(uri.path) ?? "")
    },
    applyEdit: async () => true
  };

  const window = {
    visibleTextEditors,
    get activeTextEditor() {
      return visibleTextEditors[0];
    },
    activeColorTheme: { kind: ColorThemeKind.Light },
    createTextEditorDecorationType: (
      options: Record<string, unknown>
    ): TextEditorDecorationType => {
      const type: TextEditorDecorationType = {
        options,
        dispose: () => undefined
      };
      decorationTypes.push(type);
      return type;
    },
    createCommentController: (id: string, label: string) => {
      const controller = new MockCommentController(id, label);
      commentControllers.push(controller);
      return controller;
    },
    createWebviewPanel: (
      viewType: string,
      title: string,
      showOptions: unknown,
      panelOptions: unknown
    ) => createWebviewPanel(viewType, title, showOptions, panelOptions),
    createTreeView: (_id: string, _options: unknown) => new MockTreeView(),
    registerTreeDataProvider: (_id: string, _provider: unknown) => new Disposable(),
    registerHoverProvider: (_selector: unknown, _provider: unknown) => new Disposable(),
    onDidChangeActiveTextEditor: (listener: (editor: TextEditor | undefined) => void) =>
      onDidChangeActiveTextEditor.event(listener),
    onDidChangeVisibleTextEditors: (listener: (editors: TextEditor[]) => void) =>
      onDidChangeVisibleTextEditors.event(listener),
    onDidChangeActiveColorTheme: (listener: (theme: unknown) => void) =>
      onDidChangeActiveColorTheme.event(listener),
    onDidCloseTerminal: () => new Disposable(),
    createStatusBarItem: (_alignment?: number, _priority?: number) =>
      new MockStatusBarItem(),
    showTextDocument: (uri: Uri) => showTextDocument(uri),
    showWarningMessage: (message: string) => {
      messages.push(message);
      return Promise.resolve(undefined);
    },
    showInformationMessage: (message: string, ..._items: string[]) => {
      messages.push(message);
      return Promise.resolve(undefined);
    },
    showErrorMessage: (message: string) => {
      messages.push(message);
      return Promise.resolve(undefined);
    },
    showQuickPick: async () => undefined,
    showInputBox: async () => undefined,
    createTerminal: () => ({
      show: () => undefined,
      sendText: () => undefined,
      dispose: () => undefined
    })
  };

  const vscode = {
    Uri,
    Position,
    Range,
    Selection,
    MarkdownString,
    ThemeColor,
    ThemeIcon,
    TreeItem,
    Disposable,
    EventEmitter,
    FileSystemError,
    ViewColumn,
    CommentMode,
    CommentThreadCollapsibleState,
    OverviewRulerLane,
    ConfigurationTarget,
    ColorThemeKind,
    TextEditorRevealType,
    StatusBarAlignment,
    TreeItemCollapsibleState,
    DecorationRangeBehavior,
    FileType,
    commands: {
      registerCommand: (id: string, handler: (...args: unknown[]) => unknown) => {
        commands.set(id, handler);
        return new Disposable(() => commands.delete(id));
      },
      executeCommand: async (id: string, ...args: unknown[]) => {
        executedCommands.push([id, args]);
        if (id === "setContext") {
          contexts.set(args[0] as string, args[1]);
          return;
        }
        // A diff editor surfaces both sides as open editors, the modified
        // one last, so tests can assert per-side selections and decorations.
        if (id === "vscode.diff") {
          const [original, modified] = args as [Uri, Uri];
          await showTextDocument(original);
          await showTextDocument(modified);
          return undefined;
        }
        const handler = commands.get(id);
        if (handler) {
          return handler(...args);
        }
        return undefined;
      },
      getCommands: () => [...commands.keys()]
    },
    comments: {
      createCommentController: (id: string, label: string) =>
        window.createCommentController(id, label)
    },
    workspace,
    window,
    languages: {
      registerHoverProvider: () => new Disposable()
    },
    extensions: {
      getExtension: (id: string) =>
        id === "vscode.git" && options.git
          ? {
              isActive: true,
              exports: {
                getAPI: (_version: number) => gitApi
              }
            }
          : undefined
    },
    env: {
      openExternal: (uri: Uri) => {
        externalLinks.push(uri);
        return Promise.resolve(true);
      },
      clipboard: {
        readText: async () => ""
      },
      appName: "Visual Studio Code"
    }
  };

  async function waitFor(
    predicate: () => boolean,
    timeoutMs = 2000,
    intervalMs = 10
  ): Promise<void> {
    const startedAt = Date.now();
    while (!predicate()) {
      if (Date.now() - startedAt > timeoutMs) {
        throw new Error("waitFor: condition was not met before timing out");
      }
      await new Promise(resolve => setTimeout(resolve, intervalMs));
    }
  }

  return {
    vscode,
    rootUri,
    extensionContext,
    contexts,
    executedCommands,
    configurationUpdates,
    fileWrites,
    messages,
    externalLinks,
    decorationTypes,
    visibleTextEditors,
    setFileContent,
    waitFor,
    liveThreads: () =>
      commentControllers.flatMap(controller =>
        controller.threads.filter(thread => !thread.disposed)
      ),
    livePanels: (viewType?: string) =>
      panels.filter(panel => !panel.disposed && (!viewType || panel.viewType === viewType)),
    postedMessages: () => panels.flatMap(panel => panel.postedMessages),
    // Makes writes to the given path fail like a full disk or a locked file,
    // and can be reverted to let a retry succeed.
    failWrite: (path: string) => failingWrites.add(path),
    allowWrite: (path: string) => failingWrites.delete(path),
    panelHtml: () => {
      const live = panels.filter(panel => !panel.disposed);
      const last = live[live.length - 1];
      return last ? last.webview.html : "";
    },
    editorFor: (path: string) =>
      visibleTextEditors.find(
        editor => editor.document.uri.path.endsWith(path)
      ) as MockTextEditor | undefined,
    changeColorTheme: (kind: number) => {
      (window.activeColorTheme as { kind: number }).kind = kind;
      onDidChangeActiveColorTheme.fire({ kind });
    }
  };
}

export type VscodeHost = ReturnType<typeof createVscodeHost>;
