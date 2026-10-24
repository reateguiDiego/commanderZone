import { test } from '@playwright/test';
import { writeFile } from 'node:fs/promises';
import { installRecorder, summarize, type Sample } from './support/browser-performance';
import { installNetworkRecorder, type NetworkRecord } from './support/browser-performance-network';

test('single-user guided browser recording', async ({ page, browser, baseURL }, testInfo) => {
  test.skip(process.env['BROWSER_PERF'] !== 'record', 'Opt-in manual performance session');
  test.setTimeout(45 * 60_000);
  const focused = process.env['BROWSER_PERF_FOCUS'] === '1';
  const steps = [
    ['decks', 'Abre Mazos desde el menú. Espera a ver el listado y poder usarlo.'],
    ['deck-detail', 'Abre un mazo de unas 100 cartas. Espera a que el listado sea utilizable.'],
    ['deck-spoiler', 'Activa Spoiler y desplázate por el mazo. Comprueba las imágenes y la fluidez.'],
    ['deck-analysis', 'Abre el análisis del mazo. Espera a ver y poder usar los gráficos.'],
    ['deck-editor', 'Abre el editor y su búsqueda de cartas. No guardes cambios durante esta medición.'],
    ['cards', 'Abre /cards desde el menú. Espera a poder buscar.'],
    ['search-seton', 'Busca Seton por nombre. Comprueba que los resultados corresponden a la consulta.'],
    ['search-aterrizaje', 'Busca aterrizaje en texto de reglas. Revisa los resultados, no solo el tiempo.'],
    ['search-landfall', 'Repite la búsqueda de texto con landfall. Compara los resultados.'],
    ['search-filter', 'Aplica un filtro y cambia de página si hay resultados suficientes.'],
    ['rooms', 'Abre Salas y comprueba cuándo puedes usar el listado.'],
  ].filter(([name]) => !focused || ['decks', 'deck-detail', 'deck-analysis', 'cards', 'search-aterrizaje', 'search-landfall', 'search-filter'].includes(name));
  if (process.env['BROWSER_PERF_GAME'] === '1') steps.push(
    ['room-deck', 'En una sala privada de pruebas ya preparada, selecciona tu mazo. Espera a ver la selección aplicada.'],
    ['game-entry', 'Entra a la partida de pruebas acordada. Espera a ver la mesa y poder usar sus controles. No uses salas de otras personas.'],
  );
  const results: object[] = [];
  let active: { samples: Sample[]; network: NetworkRecord[]; started: number; dropped: number; httpErrors: number; requestFailures: number; pageErrors: number } | undefined;
  let complete: ((result: string) => void) | undefined;
  let panel = { text: '', button: '', measuring: false };
  let aborted = false;
  let supportedEntryTypes: string[] = [];
  const apiOrigin = new URL(process.env['BROWSER_PERF_API_URL'] || 'https://api.commanderzone.com').origin;
  const network = installNetworkRecorder(page, apiOrigin, () => active?.network);
  await installRecorder(page, sample => {
    if (!active || sample.at < active.started) return;
    if (active.samples.length < 15000) active.samples.push(sample); else active.dropped++;
  });
  page.on('response', response => { if (active && response.status() >= 400) active.httpErrors++; });
  page.on('requestfailed', () => { if (active) active.requestFailures++; });
  page.on('pageerror', () => { if (active) active.pageErrors++; });
  await page.exposeBinding('__czPerfContinue', (_source, result: string) => { complete?.(result); complete = undefined; });
  const renderPanel = async () => {
    await page.evaluate(({ text, button, measuring }) => {
      let node = document.getElementById('cz-perf-controls');
      if (!node) {
        node = document.createElement('aside');
        node.id = 'cz-perf-controls';
        node.style.cssText = 'position:fixed;bottom:12px;left:12px;z-index:2147483647;width:340px;padding:14px;background:#fff;color:#111;border:2px solid #765500;border-radius:8px;font:14px sans-serif;box-shadow:0 2px 12px #0008';
        document.body.append(node);
      }
      node.replaceChildren();
      const description = document.createElement('p');
      description.textContent = text;
      node.append(description);
      const choices = measuring ? [['Listo · fluido', 'smooth'], ['Listo · lento', 'slow'], ['Omitir', 'skipped']] : [[button, 'continue']];
      for (const [label, value] of choices) {
        const next = document.createElement('button');
        next.dataset['czPerfControl'] = 'true';
        next.textContent = label;
        next.style.cssText = 'padding:8px;margin:3px;background:#111;color:white;cursor:pointer';
        next.onclick = () => {
          node!.querySelectorAll('button').forEach(b => b.disabled = true);
          void (window as any).__czPerfContinue(value);
        };
        node.append(next);
      }
    }, panel);
  };
  // Restore controls across hard navigations as well as Angular SPA navigation.
  page.on('domcontentloaded', () => { if (panel.text) void renderPanel().catch(() => {}); });
  async function prompt(text: string, button: string, measuring = false) {
    panel = { text, button, measuring };
    let onClose: () => void = () => {};
    const waiting = new Promise<string>((resolve, reject) => {
      complete = resolve;
      onClose = () => reject(new Error('Recording window closed before completion'));
      page.once('close', onClose);
    });
    try {
      await renderPanel();
      return await waiting;
    } finally { page.off('close', onClose); }
  }
  const reportPath = testInfo.outputPath('browser-performance.json');
  async function save() {
    await network.flush();
    await writeFile(reportPath, JSON.stringify({
      version: 'single-user-browser-v3', observerScope: 'main-frame', focused, apiOrigin, recordedAt: new Date().toISOString(),
      targetOrigin: new URL(baseURL!).origin, browser: browser.version(),
      deployedCommit: process.env['DEPLOYED_COMMIT'] || 'unverified',
      viewport: page.viewportSize(), supportedEntryTypes, aborted, results,
      limitations: [
        'Guided manual durations include human reaction and reading; not automated load times.',
        'First visit is after login; shared bundles and server caches may already be warm.',
        'Worst Event Timing is not INP; layoutShiftSum is not session-window CLS; blockingBeyond50ms is not Lighthouse TBT.',
        'Resource sizes/TTFB may be unavailable for cross-origin resources without Timing-Allow-Origin. Zero is not proof of a cache hit.',
        'Network records use Playwright timing, assigned to the step where the request STARTED. Pending requests are not awaited; they may finish after Listo.',
        'Waiting for response includes network and server work, not just SQL. A UUID requestId permits backend log correlation.',
        'LCP and paint entries describe document loads, not Angular SPA route completion.',
        'No performance thresholds: completion is not a performance pass. Compare repeated journeys on the same machine.',
      ],
    }, null, 2));
  }
  try {
    await page.goto('/auth/login');
    supportedEntryTypes = await page.evaluate(() => [...PerformanceObserver.supportedEntryTypes]);
    await prompt('Inicia sesión manualmente con una cuenta de pruebas. No se registra el login. Mantén esta ventana visible. Cuando estés dentro, continúa.', 'Ya he iniciado sesión');
    for (const phase of ['first-visit', 'repeat-visit']) {
      for (const [name, instruction] of steps) {
        await prompt(`${phase} — ${instruction} Pulsa Empezar ANTES de realizar la acción.`, 'Empezar');
        active = { started: Date.now(), samples: [], network: [], dropped: 0, httpErrors: 0, requestFailures: 0, pageErrors: 0 };
        const perception = await prompt(`${instruction} Pulsa Listo cuando el contenido sea visible y utilizable. Omite lo que no puedas realizar.`, 'Listo', true);
        await page.evaluate(async () => {
          await new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve)));
          (window as any).__czPerfFlush?.();
        });
        const captured = active;
        active = undefined;
        results.push({ phase, name, perception, manualElapsedMs: Date.now() - captured.started,
          ...summarize(captured.samples), httpErrors: captured.httpErrors,
          requestFailures: captured.requestFailures, pageErrors: captured.pageErrors,
          droppedSamples: captured.dropped, samples: captured.samples, network: captured.network });
        await save();
      }
    }
    await prompt('Captura terminada. El informe se ha guardado. Puedes cerrar esta sesión con Finalizar.', 'Finalizar');
  } catch (error) {
    aborted = true;
    throw error;
  } finally {
    await save();
    await testInfo.attach('browser-performance', { path: reportPath, contentType: 'application/json' });
    console.log('Informe de navegador: ' + reportPath);
  }
});
