import { installAtlasRenderer } from '../src/cloud/rendererAdapter';
import { collectDiagnostics, recordDiagnosticError } from '../src/utils/diagnostics';
import { createElement } from 'react';
import { createRoot } from 'react-dom/client';
import { AccentGlows } from '../src/components/ui/AccentGlows';
function mountGlows() {
  document.body.style.margin = '0';
  document.body.innerHTML = '<div data-global-scroll-root style="height:500px;overflow:auto"><div style="position:relative;isolation:isolate;width:70%;margin:auto;height:100000px"><div id="glow-test"></div></div></div>';
  const host = document.getElementById('glow-test')!;
  // The glow component measures its immediate content parent.
  host.style.cssText = 'position:relative;height:100%;isolation:isolate';
  createRoot(host).render(createElement(AccentGlows, { seed: 'long-list-test' }));
}
Object.assign(window, { desktopTest: { installAtlasRenderer, collectDiagnostics, recordDiagnosticError, mountGlows } });
