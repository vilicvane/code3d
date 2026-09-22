import {
  action,
  autorun,
  computed,
  makeObservable,
  observable,
  observableRef,
  reaction,
  runInAction,
} from 'mobx';
import type {PackageInstallationProgress} from '../project/browser-package-manager';
import type {PackageCompatibilityIssue} from '../project/package-compatibility';
import {projectDirectory} from '../project/project';

/** One explorer view for package operations and the current model's compatibility diagnostic. */
export class PackageStatusView {
  readonly element = document.createElement('section');
  private readonly notice = document.createElement('div');
  private readonly versions = document.createElement('div');
  private readonly instructions = document.createElement('p');
  private readonly manifests = document.createElement('div');
  private readonly status = document.createElement('p');
  private readonly downloads = document.createElement('div');
  private readonly details = document.createElement('details');
  private readonly buttons: HTMLButtonElement[] = [];
  private readonly updateButton?: HTMLButtonElement;
  private readonly stop: (() => void)[] = [];
  private readonly progress = observable.map<
    string,
    PackageInstallationProgress
  >(undefined, {deep: false});
  private readonly hideTimers = new Map<string, number>();
  private readonly downloadRows = new Map<
    string,
    {
      element: HTMLDivElement;
      message: HTMLSpanElement;
      retry: HTMLButtonElement;
    }
  >();
  private operation?: {label: string; issue: string};
  private failure?: {message: string; issue: string};
  private renderedIssue = '';
  private disposed = false;

  constructor(
    host: HTMLElement,
    private readonly options: {
      issue(): PackageCompatibilityIssue | undefined;
      update?(issue: PackageCompatibilityIssue): Promise<void>;
      retry?(directory: string): Promise<void>;
      openManifest(path: string): Promise<void>;
      refresh(): Promise<void>;
      clearCache(): Promise<void>;
      reload(): Promise<void>;
      focusExplorer(): void;
    },
  ) {
    makeObservable<this, 'operation' | 'failure' | 'issue' | 'key'>(this, {
      operation: observableRef,
      failure: observableRef,
      issue: computed,
      key: computed,
      run: action,
      setProgress: action,
    });
    this.element.className = 'project-status package-status';
    this.element.setAttribute('role', 'status');
    this.element.setAttribute('aria-label', 'Packages');
    this.element.tabIndex = -1;
    this.element.hidden = true;
    this.notice.className = 'package-compatibility-notice';
    this.notice.setAttribute('role', 'alert');
    this.notice.setAttribute('aria-label', 'Code3D package version mismatch');
    const title = document.createElement('strong');
    title.textContent = 'Code3D version mismatch';
    const actions = document.createElement('div');
    actions.className = 'package-status-actions';
    if (options.update) {
      this.updateButton = this.button('Update Code3D packages', issue =>
        options.update!(issue),
      );
      this.updateButton.dataset.primary = '';
      actions.append(this.updateButton);
    } else {
      const refresh = this.button('Refresh', () => options.refresh());
      refresh.dataset.primary = '';
      actions.append(refresh);
    }
    const summary = document.createElement('summary');
    summary.textContent = 'Details';
    this.manifests.className = 'package-compatibility-manifests';
    const reload = document.createElement('p');
    reload.textContent =
      'If your packages are newer than this app, reload the app to check for an update.';
    const cache = document.createElement('p');
    cache.textContent =
      'If problems remain after versions match, clear the build cache. This keeps your files and installed packages; it does not upgrade packages.';
    this.details.append(
      summary,
      this.versions,
      this.instructions,
      this.manifests,
    );
    if (options.update)
      this.details.append(this.button('Refresh', () => options.refresh()));
    this.details.append(
      reload,
      this.button('Reload app', () => options.reload()),
      cache,
      this.button('Clear build cache', () => options.clearCache()),
    );
    this.status.className = 'package-compatibility-status';
    this.status.hidden = true;
    this.notice.append(title, actions, this.status, this.details);
    this.downloads.className = 'package-downloads';
    this.element.append(this.notice, this.downloads);
    host.append(this.element);
    this.stop.push(
      reaction(
        () => this.issue,
        issue => this.renderIssue(issue),
        {fireImmediately: true},
      ),
    );
    this.stop.push(autorun(() => this.renderProgress()));
    this.stop.push(
      autorun(() => {
        const {operation, failure, key} = this;
        const downloading = [...this.progress.values()].some(
          item => item.state === 'busy',
        );
        const hidden = !this.issue && !this.progress.size;
        if (hidden && this.element.contains(document.activeElement))
          this.options.focusExplorer();
        this.element.hidden = hidden;
        this.element.setAttribute(
          'aria-busy',
          String(!!operation || downloading),
        );
        this.notice.setAttribute('aria-busy', String(!!operation));
        for (const button of this.buttons) button.disabled = !!operation;
        for (const button of this.manifests.querySelectorAll('button'))
          button.disabled = !!operation;
        const message =
          operation?.issue === key
            ? `${operation.label}…`
            : failure?.issue === key
              ? failure.message
              : '';
        this.status.textContent = message;
        this.status.hidden = !message;
        this.status.dataset.error = String(!operation && !!message);
      }),
    );
  }

  private get issue(): PackageCompatibilityIssue | undefined {
    return this.options.issue();
  }

  private get key(): string {
    return JSON.stringify(this.issue) ?? '';
  }

  setProgress(progress: PackageInstallationProgress): void {
    if (this.disposed) return;
    window.clearTimeout(this.hideTimers.get(progress.directory));
    this.hideTimers.delete(progress.directory);
    this.progress.set(progress.directory, progress);
    if (progress.state === 'ready')
      this.hideTimers.set(
        progress.directory,
        window.setTimeout(() => {
          runInAction(() => this.progress.delete(progress.directory));
          this.hideTimers.delete(progress.directory);
        }, 3000),
      );
  }

  private renderProgress(): void {
    const affected = (directory: string) =>
      this.issue?.packages.some(
        pkg => projectDirectory(pkg.manifestPath) === directory,
      );
    const entries = [...this.progress.values()].filter(
      item =>
        !(item.state === 'ready' && affected(item.directory)) &&
        !(
          item.state === 'error' &&
          this.failure?.issue === this.key &&
          this.failure.message === item.message
        ),
    );
    const visible = new Set(entries.map(item => item.directory));
    for (const [directory, row] of this.downloadRows) {
      if (visible.has(directory)) continue;
      if (row.element.contains(document.activeElement))
        this.element.focus({preventScroll: true});
      row.element.remove();
      this.downloadRows.delete(directory);
    }
    this.downloads.hidden = !entries.length;
    for (const item of entries) {
      let row = this.downloadRows.get(item.directory);
      if (!row) {
        const element = document.createElement('div');
        element.className = 'package-download';
        element.dataset.directory = item.directory;
        const directory = document.createElement('span');
        directory.className = 'package-status-directory';
        directory.textContent =
          item.directory === '/' ? 'Packages' : item.directory;
        const message = document.createElement('span');
        message.className = 'package-download-message';
        const retry = document.createElement('button');
        retry.type = 'button';
        retry.textContent = 'Retry';
        retry.addEventListener('click', () => {
          void this.options.retry!(item.directory).catch(error => {
            this.setProgress({
              directory: item.directory,
              state: 'error',
              message: error instanceof Error ? error.message : String(error),
            });
          });
        });
        element.append(directory, message, retry);
        this.downloads.append(element);
        row = {element, message, retry};
        this.downloadRows.set(item.directory, row);
      }
      row.element.dataset.state = item.state;
      row.message.textContent = item.message;
      row.message.title = item.message;
      const hideRetry =
        item.state !== 'error' ||
        !this.options.retry ||
        !!affected(item.directory);
      if (hideRetry && row.retry === document.activeElement)
        this.element.focus({preventScroll: true});
      row.retry.hidden = hideRetry;
    }
  }

  private button(
    label: string,
    command: (issue: PackageCompatibilityIssue) => Promise<void>,
  ): HTMLButtonElement {
    const button = document.createElement('button');
    button.type = 'button';
    button.textContent = label;
    button.addEventListener('click', () => void this.run(label, command));
    this.buttons.push(button);
    return button;
  }

  private renderIssue(issue: PackageCompatibilityIssue | undefined): void {
    this.notice.hidden = !issue;
    if (this.renderedIssue !== this.key) this.details.open = false;
    this.renderedIssue = this.key;
    if (!issue) return;
    this.versions.replaceChildren(
      ...issue.packages.map(pkg => {
        const row = document.createElement('div');
        row.className = 'package-version';
        const name = document.createElement('code');
        name.textContent = pkg.name;
        const versions = document.createElement('dl');
        for (const [label, value] of [
          ['Installed', pkg.installed],
          ['Required', pkg.expected],
        ]) {
          const term = document.createElement('dt');
          term.textContent = label;
          const description = document.createElement('dd');
          description.textContent = value;
          versions.append(term, description);
        }
        row.append(name, versions);
        return row;
      }),
    );
    const paths = [...new Set(issue.packages.map(pkg => pkg.manifestPath))];
    const manual = issue.packages.filter(pkg => pkg.manual);
    if (this.updateButton) this.updateButton.hidden = manual.length > 0;
    this.instructions.textContent = manual.length
      ? manual
          .map(pkg =>
            pkg.manual!.reason === 'transitive'
              ? `${pkg.manual!.dependency} loads this version of ${pkg.name}. Update the project dependency that provides it to a release using ${pkg.name}@${pkg.expected}.`
              : `Declare ${pkg.name}@${pkg.expected} in ${pkg.manifestPath}.`,
          )
          .join('\n') +
        (this.options.update
          ? '\nBrowser storage installs changed declarations when you run the model again.'
          : '\nInstall with your package manager, then choose Refresh.')
      : this.options.update
        ? 'Update installed Code3D packages and outdated version declarations. Your latest declarations and other dependencies are kept.'
        : 'Update packages in each folder below with your package manager. Keep latest declarations; change outdated pinned versions to the required versions. Then choose Refresh.';
    this.manifests.replaceChildren(
      ...paths.map(path => {
        const button = document.createElement('button');
        button.type = 'button';
        button.textContent =
          paths.length === 1 ? 'Open package.json' : `Open ${path}`;
        button.title = path;
        button.dataset.path = path;
        button.disabled = !!this.operation;
        button.addEventListener(
          'click',
          () =>
            void this.run('Opening package.json', () =>
              this.options.openManifest(path),
            ),
        );
        const entry = document.createElement('div');
        const label = document.createElement('code');
        label.textContent = path;
        entry.append(label, button);
        return entry;
      }),
    );
  }

  async run(
    label: string,
    command: (issue: PackageCompatibilityIssue) => Promise<void>,
  ): Promise<void> {
    const issue = this.issue;
    if (!issue || this.operation || this.disposed) return;
    const key = this.key;
    this.operation = {label, issue: key};
    this.failure = undefined;
    try {
      await command(issue);
    } catch (error) {
      if (!this.disposed)
        runInAction(() => {
          this.failure = {
            issue: key,
            message: error instanceof Error ? error.message : String(error),
          };
        });
    } finally {
      if (!this.disposed)
        runInAction(() => {
          this.operation = undefined;
        });
    }
  }

  dispose(): void {
    this.disposed = true;
    this.stop.forEach(stop => stop());
    this.hideTimers.forEach(timer => window.clearTimeout(timer));
    this.hideTimers.clear();
    this.element.remove();
  }
}
