import type { AppApi } from '../preload/index.js';
import type { ChatgptProjectChoice, ChatgptProjectSyncResult, LocalProject } from '../shared/projects.js';
import { t } from './i18n.js';

type ImportApi = Pick<AppApi, 'addGitHubProject' | 'chatgptProjectChoices' | 'syncChatgptProjects'>;
type Reply<T> = { ok: true; data: T } | { ok: false; error: string };

const element = <T extends HTMLElement = HTMLElement>(id: string): T => document.getElementById(id) as T;
const showModal = (dialog: HTMLDialogElement) => {
  if (typeof dialog.showModal === 'function') dialog.showModal(); else dialog.setAttribute('open', '');
};
const closeModal = (dialog: HTMLDialogElement) => {
  if (typeof dialog.close === 'function') dialog.close(); else dialog.removeAttribute('open');
};
const errorText = (id: string, message: string | null) => {
  const error = element(id);
  error.hidden = !message;
  error.textContent = message ?? '';
};

/** Dedicated choices: GitHub stores a cloud-only repository reference; ChatGPT sync links native Projects. */
export function initProjectImportDialogs(api: ImportApi, callbacks: {
  githubAdded(project: LocalProject): void;
  chatgptSynced(result: ChatgptProjectSyncResult): void;
}): { openGithub(): void; openChatgpt(): Promise<void> } {
  const github = element<HTMLDialogElement>('githubProjectDialog');
  const githubForm = element<HTMLFormElement>('githubProjectForm');
  const githubUrl = element<HTMLInputElement>('githubProjectUrl');
  const githubSubmit = element<HTMLButtonElement>('githubProjectSubmit');
  const githubCancel = [element<HTMLButtonElement>('githubProjectCancel'), element<HTMLButtonElement>('githubProjectClose')];
  let githubBusy = false;

  const githubSetBusy = (busy: boolean) => {
    githubBusy = busy;
    githubSubmit.disabled = busy;
    githubSubmit.textContent = busy ? t('Creating project…') : t('Create cloud project');
    for (const button of githubCancel) button.disabled = busy;
    githubUrl.disabled = busy;
  };
  github.addEventListener('cancel', event => { if (githubBusy) event.preventDefault(); });
  for (const button of githubCancel) button.addEventListener('click', () => { if (!githubBusy) closeModal(github); });
  githubForm.addEventListener('submit', async event => {
    event.preventDefault();
    if (githubBusy) return;
    errorText('githubProjectError', null);
    githubSetBusy(true);
    try {
      const reply = await api.addGitHubProject(githubUrl.value.trim());
      if (!reply.ok) { errorText('githubProjectError', reply.error); return; }
      if (reply.data) { closeModal(github); callbacks.githubAdded(reply.data); }
    } catch (error) {
      errorText('githubProjectError', error instanceof Error ? error.message : String(error));
    } finally { githubSetBusy(false); }
  });

  const sync = element<HTMLDialogElement>('chatgptSyncDialog');
  const search = element<HTMLInputElement>('chatgptSyncSearch');
  const list = element('chatgptSyncList');
  const selectedButton = element<HTMLButtonElement>('chatgptSyncSelected');
  const allButton = element<HTMLButtonElement>('chatgptSyncAll');
  const syncCancel = [element<HTMLButtonElement>('chatgptSyncCancel'), element<HTMLButtonElement>('chatgptSyncClose')];
  let choices: ChatgptProjectChoice[] = [];
  let selected = new Set<string>();
  let syncBusy = false;
  let loadSequence = 0;

  const syncSetBusy = (busy: boolean) => {
    syncBusy = busy;
    search.disabled = busy;
    for (const button of syncCancel) button.disabled = busy;
    for (const checkbox of list.querySelectorAll<HTMLInputElement>('input[type=checkbox]')) checkbox.disabled = busy;
    selectedButton.disabled = busy || !selected.size;
    allButton.disabled = busy || !choices.length;
    selectedButton.textContent = busy ? t('Syncing…') : t('Sync selected ({0})', [selected.size]);
  };
  const paint = () => {
    list.replaceChildren();
    const needle = search.value.trim().toLocaleLowerCase();
    const filtered = choices.filter(choice => choice.name.toLocaleLowerCase().includes(needle));
    if (!filtered.length) {
      const empty = document.createElement('p');
      empty.className = 'chatgpt-sync-empty';
      empty.textContent = choices.length ? t('No matching Projects') : t('No ChatGPT Projects found. Open chatgpt.com and refresh the Projects sidebar.');
      list.append(empty);
    }
    for (const choice of filtered) {
      const label = document.createElement('label');
      label.className = 'chatgpt-sync-choice';
      const checkbox = document.createElement('input');
      checkbox.type = 'checkbox';
      checkbox.value = choice.id;
      checkbox.checked = selected.has(choice.id);
      checkbox.disabled = syncBusy;
      checkbox.addEventListener('change', () => {
        if (checkbox.checked) selected.add(choice.id); else selected.delete(choice.id);
        syncSetBusy(false);
      });
      const text = document.createElement('span');
      text.textContent = choice.name;
      if (choice.linkedTo) {
        const note = document.createElement('small');
        note.textContent = t('Already linked to {0}', [choice.linkedTo.name]);
        text.append(note);
      }
      label.append(checkbox, text);
      list.append(label);
    }
    syncSetBusy(syncBusy);
  };
  search.addEventListener('input', paint);
  sync.addEventListener('cancel', event => { if (syncBusy) event.preventDefault(); });
  for (const button of syncCancel) button.addEventListener('click', () => {
    if (!syncBusy) { ++loadSequence; closeModal(sync); }
  });
  const performSync = async (ids?: string[]) => {
    if (syncBusy || (ids && !ids.length)) return;
    errorText('chatgptSyncError', null);
    syncSetBusy(true);
    try {
      const reply: Reply<ChatgptProjectSyncResult | null> = await api.syncChatgptProjects(ids);
      if (!reply.ok) { errorText('chatgptSyncError', reply.error); return; }
      if (reply.data) { closeModal(sync); callbacks.chatgptSynced(reply.data); }
    } catch (error) {
      errorText('chatgptSyncError', error instanceof Error ? error.message : String(error));
    } finally { syncSetBusy(false); }
  };
  selectedButton.addEventListener('click', () => void performSync([...selected]));
  allButton.addEventListener('click', () => void performSync());

  return {
    openGithub() {
      githubForm.reset();
      errorText('githubProjectError', null);
      githubSetBusy(false);
      showModal(github);
      githubUrl.focus();
    },
    async openChatgpt() {
      const version = ++loadSequence;
      choices = [];
      selected = new Set();
      search.value = '';
      errorText('chatgptSyncError', null);
      paint();
      showModal(sync);
      try {
        const reply = await api.chatgptProjectChoices();
        if (version !== loadSequence || !sync.open) return;
        if (!reply.ok) { errorText('chatgptSyncError', reply.error); return; }
        choices = reply.data;
        selected = new Set(choices.filter(choice => !choice.linkedTo).map(choice => choice.id));
        paint();
      } catch (error) {
        if (version === loadSequence) errorText('chatgptSyncError', error instanceof Error ? error.message : String(error));
      }
      search.focus();
    }
  };
}
