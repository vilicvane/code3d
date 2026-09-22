import {action, autorun, makeObservable, observableRef} from 'mobx';
import {AppDialog} from './dialog';

export type NewBrowserProjectInput = Readonly<{
  name: string;
  createExamples: boolean;
}>;

export function showNewBrowserProjectDialog(
  create: (input: NewBrowserProjectInput) => Promise<void>,
): Promise<void> {
  return new Promise(resolve => {
    const listeners = new AbortController();
    const {signal} = listeners;
    const state = {
      busy: false,
      error: undefined as {message: string; field?: 'name'} | undefined,
      start() {
        this.busy = true;
        this.error = undefined;
      },
      fail(message: string, field?: 'name') {
        this.busy = false;
        this.error = {message, field};
      },
      clearError() {
        this.error = undefined;
      },
    };
    makeObservable(state, {
      busy: observableRef,
      error: observableRef,
      start: action,
      fail: action,
      clearError: action,
    });
    let settled = false;
    let stopFeedback: (() => void) | undefined;
    const finish = () => {
      if (settled) return;
      settled = true;
      listeners.abort();
      stopFeedback?.();
      dialog.dispose();
      resolve();
    };
    const dialog = new AppDialog({
      title: 'New browser project',
      className: 'message-dialog new-browser-project-dialog',
      canDismiss: () => !state.busy,
      onClose: finish,
    });
    const form = document.createElement('form');
    form.className = 'app-dialog-content';
    form.noValidate = true;
    const header = document.createElement('header');
    const title = document.createElement('h2');
    title.textContent = 'New browser project';
    const description = document.createElement('p');
    const id = `new-browser-project-${nextDialogId++}`;
    description.id = `${id}-description`;
    description.textContent = 'Create a project stored in this browser.';
    dialog.element.setAttribute('aria-describedby', description.id);
    header.append(title, description);

    const nameField = document.createElement('label');
    const nameLabel = document.createElement('span');
    nameLabel.textContent = 'Project name';
    const name = document.createElement('input');
    name.name = 'project-name';
    name.required = true;
    name.placeholder = 'My project';
    name.autocomplete = 'off';
    nameField.append(nameLabel, name);

    const examplesField = document.createElement('label');
    examplesField.className = 'project-examples-option';
    const examples = document.createElement('input');
    examples.type = 'checkbox';
    examples.name = 'create-examples';
    examples.checked = true;
    examples.setAttribute('aria-label', 'Create examples');
    const examplesCopy = document.createElement('span');
    examplesCopy.className = 'project-examples-copy';
    const examplesLabel = document.createElement('span');
    examplesLabel.textContent = 'Create examples';
    const examplesHint = document.createElement('small');
    examplesHint.id = `${id}-examples-hint`;
    examplesHint.textContent = 'Add bundled examples and a starter model.';
    examples.setAttribute('aria-describedby', examplesHint.id);
    examplesCopy.append(examplesLabel, examplesHint);
    examplesField.append(examples, examplesCopy);

    const error = document.createElement('p');
    error.className = 'dialog-error';
    error.id = `${id}-error`;
    error.setAttribute('role', 'alert');
    name.setAttribute('aria-describedby', error.id);
    const footer = document.createElement('footer');
    const cancel = document.createElement('button');
    cancel.type = 'button';
    cancel.className = 'dialog-button';
    cancel.textContent = 'Cancel';
    const submit = document.createElement('button');
    submit.type = 'submit';
    submit.className = 'dialog-button button-primary';
    submit.textContent = 'Create project';
    footer.append(cancel, submit);
    form.append(header, nameField, examplesField, error, footer);
    dialog.element.append(form);

    stopFeedback = autorun(() => {
      error.textContent = state.error?.message ?? '';
      error.hidden = !state.error;
      const nameError = state.error?.field === 'name';
      name.setAttribute('aria-invalid', String(nameError));
      name.setCustomValidity(nameError ? state.error!.message : '');
      name.disabled = state.busy;
      examples.disabled = state.busy;
      cancel.disabled = state.busy;
      submit.disabled = state.busy;
      submit.textContent = state.busy ? 'Creating…' : 'Create project';
      form.setAttribute('aria-busy', String(state.busy));
    });

    const createProject = async () => {
      if (state.busy) return;
      const input = {name: name.value.trim(), createExamples: examples.checked};
      if (!input.name) {
        state.fail('Enter project name.', 'name');
        name.focus();
        return;
      }
      state.start();
      try {
        await create(input);
        finish();
      } catch (error) {
        if (settled) return;
        state.fail(error instanceof Error ? error.message : String(error));
        name.focus();
      }
    };
    form.addEventListener(
      'submit',
      event => {
        event.preventDefault();
        void createProject();
      },
      {signal},
    );
    name.addEventListener('input', () => state.clearError(), {signal});
    examples.addEventListener('change', () => state.clearError(), {signal});
    cancel.addEventListener('click', () => dialog.dismiss(), {signal});
    window.addEventListener('pagehide', finish, {signal});
    dialog.open(name);
  });
}

let nextDialogId = 1;
