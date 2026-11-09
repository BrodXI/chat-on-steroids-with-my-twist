import type { AppApi } from '../preload/index.js';
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

export function initWorkspacePluginRefresh(
  api: Pick<AppApi, 'requestPluginRefresh'>,
  notify: (message: string) => void = toast
): void {
  const button = document.getElementById('workspaceRefreshPlugins') as HTMLButtonElement;
  const label = document.getElementById('workspaceRefreshPluginsLabel')!;
  ui(label, 'textContent', () => copy[currentLanguage()].label);
  ui(button, 'title', () => copy[currentLanguage()].hint);

  let busy = false;
  button.addEventListener('click', async () => {
    if (busy) return;
    busy = true;
    button.disabled = true;
    button.setAttribute('aria-busy', 'true');
    try {
      const reply = await api.requestPluginRefresh();
      // Enqueued is not completed: the browser may still be disconnected or settling.
      notify(reply.ok
        ? reply.data > 0 ? copy[currentLanguage()].queued : copy[currentLanguage()].unavailable
        : copy[currentLanguage()].failed);
    } catch {
      notify(copy[currentLanguage()].failed);
    } finally {
      busy = false;
      button.disabled = false;
      button.removeAttribute('aria-busy');
    }
  });
}
