import type { AppApi } from '../preload/index.js';
import type { PluginSurface } from '../shared/plugin-refresh.js';
import type { WorkspacePluginRefreshStep } from '../shared/workspace-plugin-refresh.js';
import { currentLanguage, ui, type Language } from './i18n.js';
import { toast } from './dom.js';

type Copy = { label: string; hint: string; queued: string; unavailable: string; failed: string };
// Fork-only copy lives here, rather than forcing every upstream locale JSON to conflict at sync.
const copy: Record<Language, Copy> = {
  en: { label: 'Refresh plugins', hint: 'Check the Core, Desktop and Plugins tools in ChatGPT', queued: 'Plugin refresh requested. ChatGPT will check the available connectors.', unavailable: 'No connected plugin tools are available to refresh.', failed: 'Could not request a plugin refresh.' },
  es: { label: 'Actualizar plugins', hint: 'Comprobar las herramientas de Core, Desktop y Plugins en ChatGPT', queued: 'Actualización solicitada. ChatGPT comprobará los conectores disponibles.', unavailable: 'No hay herramientas de plugins conectadas para actualizar.', failed: 'No se pudo solicitar la actualización de plugins.' },
  de: { label: 'Plugins aktualisieren', hint: 'Core-, Desktop- und Plugin-Werkzeuge in ChatGPT prüfen', queued: 'Plugin-Aktualisierung angefordert. ChatGPT prüft die verfügbaren Verbindungen.', unavailable: 'Keine verbundenen Plugin-Werkzeuge zum Aktualisieren verfügbar.', failed: 'Plugin-Aktualisierung konnte nicht angefordert werden.' },
  fr: { label: 'Actualiser les plugins', hint: 'Vérifier les outils Core, Desktop et Plugins dans ChatGPT', queued: 'Actualisation demandée. ChatGPT vérifiera les connecteurs disponibles.', unavailable: 'Aucun outil de plugin connecté à actualiser.', failed: 'Impossible de demander l’actualisation des plugins.' },
  ja: { label: 'プラグインを更新', hint: 'ChatGPT の Core、Desktop、Plugins のツールを確認', queued: 'プラグインの更新をリクエストしました。ChatGPT が利用可能な接続を確認します。', unavailable: '更新できる接続済みのプラグインツールがありません。', failed: 'プラグインの更新をリクエストできませんでした。' },
  ko: { label: '플러그인 새로고침', hint: 'ChatGPT의 Core, Desktop, Plugins 도구 확인', queued: '플러그인 새로고침을 요청했습니다. ChatGPT가 사용 가능한 연결을 확인합니다.', unavailable: '새로고침할 연결된 플러그인 도구가 없습니다.', failed: '플러그인 새로고침을 요청하지 못했습니다.' },
  'pt-BR': { label: 'Atualizar plugins', hint: 'Verificar as ferramentas Core, Desktop e Plugins no ChatGPT', queued: 'Atualização solicitada. O ChatGPT verificará os conectores disponíveis.', unavailable: 'Não há ferramentas de plugins conectadas para atualizar.', failed: 'Não foi possível solicitar a atualização dos plugins.' },
  'pt-PT': { label: 'Atualizar plugins', hint: 'Verificar as ferramentas Core, Desktop e Plugins no ChatGPT', queued: 'Atualização solicitada. O ChatGPT irá verificar os conectores disponíveis.', unavailable: 'Não há ferramentas de plugins ligadas para atualizar.', failed: 'Não foi possível solicitar a atualização dos plugins.' },
  ru: { label: 'Обновить плагины', hint: 'Проверить инструменты Core, Desktop и Plugins в ChatGPT', queued: 'Обновление запрошено. ChatGPT проверит доступные подключения.', unavailable: 'Нет подключённых инструментов плагинов для обновления.', failed: 'Не удалось запросить обновление плагинов.' },
  tr: { label: 'Eklentileri yenile', hint: 'ChatGPT içindeki Core, Desktop ve Plugins araçlarını denetle', queued: 'Eklenti yenileme istendi. ChatGPT kullanılabilir bağlantıları denetleyecek.', unavailable: 'Yenilenebilecek bağlı eklenti aracı yok.', failed: 'Eklenti yenileme isteği gönderilemedi.' },
  vi: { label: 'Làm mới plugin', hint: 'Kiểm tra công cụ Core, Desktop và Plugins trong ChatGPT', queued: 'Đã yêu cầu làm mới plugin. ChatGPT sẽ kiểm tra các kết nối hiện có.', unavailable: 'Không có công cụ plugin đã kết nối để làm mới.', failed: 'Không thể yêu cầu làm mới plugin.' },
  'zh-CN': { label: '刷新插件', hint: '检查 ChatGPT 中的 Core、Desktop 和 Plugins 工具', queued: '已请求刷新插件。ChatGPT 将检查可用的连接器。', unavailable: '没有可刷新的已连接插件工具。', failed: '无法请求刷新插件。' },
  'zh-TW': { label: '重新整理外掛', hint: '檢查 ChatGPT 中的 Core、Desktop 和 Plugins 工具', queued: '已要求重新整理外掛。ChatGPT 將檢查可用的連接器。', unavailable: '沒有可重新整理的已連接外掛工具。', failed: '無法要求重新整理外掛。' }
};

type ProgressCopy = {
  title: string; finding: string; working: string; completed: string; attention: string;
  overdue: string; waiting: string; checking: string; done: string; failed: string; manual: string;
};

const progress: Record<Language, ProgressCopy> = {
  en: { title: 'Refreshing plugins', finding: 'Finding installed ChatGPT connectors…', working: 'Checking your installed connectors…', completed: 'All installed connectors are up to date.', attention: 'Some connectors need attention.', overdue: 'Still waiting for ChatGPT. Check the browser connection.', waiting: 'Waiting', checking: 'Checking…', done: 'Done', failed: 'Failed', manual: 'Manual action needed' },
  es: { title: 'Actualizando plugins', finding: 'Buscando conectores instalados en ChatGPT…', working: 'Comprobando los conectores instalados…', completed: 'Todos los conectores están actualizados.', attention: 'Algunos conectores requieren atención.', overdue: 'Aún esperando a ChatGPT. Revisa la conexión del navegador.', waiting: 'En espera', checking: 'Comprobando…', done: 'Listo', failed: 'Error', manual: 'Acción manual necesaria' },
  de: { title: 'Plugins aktualisieren', finding: 'Installierte ChatGPT-Verbindungen suchen…', working: 'Installierte Verbindungen prüfen…', completed: 'Alle installierten Verbindungen sind aktuell.', attention: 'Einige Verbindungen benötigen Aufmerksamkeit.', overdue: 'ChatGPT antwortet noch nicht. Browserverbindung prüfen.', waiting: 'Warten', checking: 'Prüfen…', done: 'Fertig', failed: 'Fehler', manual: 'Manueller Schritt nötig' },
  fr: { title: 'Actualisation des plugins', finding: 'Recherche des connecteurs installés dans ChatGPT…', working: 'Vérification des connecteurs installés…', completed: 'Tous les connecteurs sont à jour.', attention: 'Certains connecteurs nécessitent une intervention.', overdue: 'ChatGPT ne répond pas encore. Vérifiez le navigateur.', waiting: 'En attente', checking: 'Vérification…', done: 'Terminé', failed: 'Échec', manual: 'Action manuelle requise' },
  ja: { title: 'プラグインを更新中', finding: 'ChatGPT にインストールされた接続を確認中…', working: 'インストール済みの接続を確認中…', completed: 'すべての接続は最新です。', attention: '確認が必要な接続があります。', overdue: 'ChatGPT の応答を待っています。ブラウザー接続を確認してください。', waiting: '待機中', checking: '確認中…', done: '完了', failed: '失敗', manual: '手動操作が必要' },
  ko: { title: '플러그인 새로고침', finding: 'ChatGPT에 설치된 연결 확인 중…', working: '설치된 연결을 확인 중…', completed: '모든 연결이 최신 상태입니다.', attention: '일부 연결에 조치가 필요합니다.', overdue: 'ChatGPT를 기다리는 중입니다. 브라우저 연결을 확인하세요.', waiting: '대기 중', checking: '확인 중…', done: '완료', failed: '실패', manual: '수동 작업 필요' },
  'pt-BR': { title: 'Atualizando plugins', finding: 'Procurando conectores instalados no ChatGPT…', working: 'Verificando conectores instalados…', completed: 'Todos os conectores estão atualizados.', attention: 'Alguns conectores precisam de atenção.', overdue: 'Ainda aguardando o ChatGPT. Verifique o navegador.', waiting: 'Aguardando', checking: 'Verificando…', done: 'Concluído', failed: 'Falhou', manual: 'Ação manual necessária' },
  'pt-PT': { title: 'A atualizar plugins', finding: 'A procurar conectores instalados no ChatGPT…', working: 'A verificar os conectores instalados…', completed: 'Todos os conectores estão atualizados.', attention: 'Alguns conectores precisam de atenção.', overdue: 'Ainda à espera do ChatGPT. Verifique o navegador.', waiting: 'À espera', checking: 'A verificar…', done: 'Concluído', failed: 'Falhou', manual: 'Ação manual necessária' },
  ru: { title: 'Обновление плагинов', finding: 'Поиск установленных подключений ChatGPT…', working: 'Проверка установленных подключений…', completed: 'Все подключения обновлены.', attention: 'Некоторые подключения требуют внимания.', overdue: 'Ожидание ChatGPT. Проверьте подключение браузера.', waiting: 'Ожидание', checking: 'Проверка…', done: 'Готово', failed: 'Ошибка', manual: 'Нужны ручные действия' },
  tr: { title: 'Eklentiler yenileniyor', finding: 'ChatGPT’de kurulu bağlantılar aranıyor…', working: 'Kurulu bağlantılar denetleniyor…', completed: 'Tüm bağlantılar güncel.', attention: 'Bazı bağlantıların incelenmesi gerekiyor.', overdue: 'ChatGPT bekleniyor. Tarayıcı bağlantısını kontrol edin.', waiting: 'Bekliyor', checking: 'Denetleniyor…', done: 'Tamamlandı', failed: 'Başarısız', manual: 'Manuel işlem gerekli' },
  vi: { title: 'Đang làm mới plugin', finding: 'Đang tìm kết nối đã cài trong ChatGPT…', working: 'Đang kiểm tra các kết nối đã cài…', completed: 'Tất cả kết nối đã được cập nhật.', attention: 'Một số kết nối cần được xử lý.', overdue: 'Vẫn đang chờ ChatGPT. Hãy kiểm tra kết nối trình duyệt.', waiting: 'Đang chờ', checking: 'Đang kiểm tra…', done: 'Hoàn tất', failed: 'Thất bại', manual: 'Cần thao tác thủ công' },
  'zh-CN': { title: '正在刷新插件', finding: '正在查找 ChatGPT 中已安装的连接器…', working: '正在检查已安装的连接器…', completed: '所有已安装的连接器都是最新的。', attention: '部分连接器需要处理。', overdue: '仍在等待 ChatGPT，请检查浏览器连接。', waiting: '等待中', checking: '检查中…', done: '完成', failed: '失败', manual: '需要手动操作' },
  'zh-TW': { title: '正在重新整理外掛', finding: '正在尋找 ChatGPT 中已安裝的連接器…', working: '正在檢查已安裝的連接器…', completed: '所有已安裝的連接器都是最新版本。', attention: '部分連接器需要處理。', overdue: '仍在等待 ChatGPT，請檢查瀏覽器連線。', waiting: '等待中', checking: '檢查中…', done: '完成', failed: '失敗', manual: '需要手動操作' }
};

const surfaces: Record<PluginSurface, string> = { core: 'Core', desktop: 'Desktop', plugins: 'Plugins' };
const POLL_MS = 2_000;
const WATCH_LIMIT_MS = 5 * 60_000;

type StepRow = { surface: PluginSurface; root: HTMLLIElement; symbol: HTMLElement; status: HTMLElement };
type StepOutcome = { settled: boolean; failed: boolean };

/** Never infer completion from a queued request or a prior "current" receipt awaiting recheck. */
export function workspaceRefreshOutcome(step: WorkspacePluginRefreshStep): 'done' | 'failed' | 'pending' {
  if (step.status === 'failed' || step.status === 'manual') return 'failed';
  if (step.status === 'current' && !step.observing) return 'done';
  return 'pending';
}

export function initWorkspacePluginRefresh(
  api: Pick<AppApi, 'requestPluginRefresh' | 'workspacePluginRefreshSteps'>,
  notify: (message: string) => void = toast
): void {
  const button = document.getElementById('workspaceRefreshPlugins') as HTMLButtonElement;
  const label = document.getElementById('workspaceRefreshPluginsLabel')!;
  const panel = document.getElementById('workspaceRefreshProgress')!;
  const title = document.getElementById('workspaceRefreshTitle')!;
  const summary = document.getElementById('workspaceRefreshSummary')!;
  const list = document.getElementById('workspaceRefreshSteps')!;
  const close = document.getElementById('workspaceRefreshClose') as HTMLButtonElement;
  ui(label, 'textContent', () => copy[currentLanguage()].label);
  ui(button, 'title', () => copy[currentLanguage()].hint);
  ui(title, 'textContent', () => progress[currentLanguage()].title);

  let busy = false;
  let generation = 0;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let startedAt = 0;
  let rows: StepRow[] = [];

  const cancelPolling = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const closePanel = () => {
    generation++;
    cancelPolling();
    panel.hidden = true;
    button.setAttribute('aria-expanded', 'false');
  };
  close.addEventListener('click', closePanel);
  const setSummary = (message: string) => {
    if (summary.textContent !== message) summary.textContent = message;
  };
  const paint = (steps: WorkspacePluginRefreshStep[]): StepOutcome => {
    const evidence = new Map(steps.map(step => [step.surface, step]));
    const results = rows.map(row => workspaceRefreshOutcome(evidence.get(row.surface) ??
      { surface: row.surface, status: 'unknown', observing: false }));
    const firstPending = results.indexOf('pending');
    rows.forEach((row, index) => {
      const data = evidence.get(row.surface);
      const outcome = results[index];
      const active = outcome === 'pending' && index === firstPending;
      row.root.classList.toggle('is-done', outcome === 'done');
      row.root.classList.toggle('is-failed', outcome === 'failed');
      row.root.classList.toggle('is-active', active);
      row.symbol.className = 'ico ph ' + (outcome === 'done' ? 'ph-check-circle' :
        outcome === 'failed' ? 'ph-warning-circle' : active ? 'ph-circle-notch' : 'ph-circle');
      const words = progress[currentLanguage()];
      const statusText = outcome === 'done' ? words.done :
        outcome === 'failed' ? data?.status === 'manual' ? words.manual : words.failed :
        active || data?.status === 'refreshing' ? words.checking : words.waiting;
      if (row.status.textContent !== statusText) row.status.textContent = statusText;
    });
    return { settled: results.every(result => result !== 'pending'), failed: results.includes('failed') };
  };

  const makeRows = (steps: WorkspacePluginRefreshStep[]) => {
    list.replaceChildren();
    rows = steps.map((step, index) => {
      const root = document.createElement('li');
      root.className = 'workspace-refresh-step';
      root.style.setProperty('--step-index', String(index));
      const icon = document.createElement('span');
      icon.className = 'workspace-refresh-step-icon';
      icon.setAttribute('aria-hidden', 'true');
      const symbol = document.createElement('i');
      icon.append(symbol);
      const name = document.createElement('span');
      name.className = 'workspace-refresh-step-name';
      name.textContent = String(index + 1) + '. ' + surfaces[step.surface];
      const status = document.createElement('span');
      status.className = 'workspace-refresh-step-status';
      root.append(icon, name, status);
      list.append(root);
      return { surface: step.surface, root, symbol, status };
    });
  };

  const read = async (own: number, first = false): Promise<void> => {
    let reply: Awaited<ReturnType<typeof api.workspacePluginRefreshSteps>>;
    try { reply = await api.workspacePluginRefreshSteps(); }
    catch {
      if (own === generation) { setSummary(copy[currentLanguage()].failed); cancelPolling(); }
      return;
    }
    if (own !== generation) return;
    if (!reply.ok) { setSummary(copy[currentLanguage()].failed); cancelPolling(); return; }
    const steps = reply.data;
    if (first) {
      if (!steps.length) {
        setSummary(copy[currentLanguage()].unavailable);
        notify(copy[currentLanguage()].unavailable);
        return;
      }
      makeRows(steps);
    }
    if (!rows.length) return;
    const outcome = paint(steps);
    if (outcome.settled) {
      setSummary(progress[currentLanguage()][outcome.failed ? 'attention' : 'completed']);
      cancelPolling();
      return;
    }
    if (Date.now() - startedAt >= WATCH_LIMIT_MS) {
      setSummary(progress[currentLanguage()].overdue);
      cancelPolling();
      return;
    }
    setSummary(progress[currentLanguage()].working);
    cancelPolling();
    timer = setTimeout(() => { void read(own); }, POLL_MS);
  };

  button.addEventListener('click', async () => {
    if (busy) return;
    const own = ++generation;
    cancelPolling();
    rows = [];
    list.replaceChildren();
    panel.hidden = false;
    button.setAttribute('aria-expanded', 'true');
    setSummary(progress[currentLanguage()].finding);
    busy = true;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    try {
      const reply = await api.requestPluginRefresh();
      if (own !== generation) return;
      if (!reply.ok) {
        setSummary(copy[currentLanguage()].failed);
        notify(copy[currentLanguage()].failed);
      } else if (!reply.data) {
        setSummary(copy[currentLanguage()].unavailable);
        notify(copy[currentLanguage()].unavailable);
      } else {
        // The request merely queues work. Each row turns green only after provider evidence.
        startedAt = Date.now();
        await read(own, true);
      }
    } catch {
      if (own === generation) {
        setSummary(copy[currentLanguage()].failed);
        notify(copy[currentLanguage()].failed);
      }
    } finally {
      busy = false;
      button.disabled = false;
      button.removeAttribute('aria-busy');
    }
  });
}
