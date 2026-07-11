// background.js — Nexus unified extension entry point
// ES module; single service worker for all 6 merged providers.

import { init as initBrowser,  handlers as browserHandlers  } from './providers/browser.js';
import { init as initWebRTC,   handlers as webrtcHandlers   } from './providers/webrtc.js';
import { init as initUA,       handlers as uaHandlers       } from './providers/ua.js';
import { init as initBL,       handlers as blHandlers       } from './providers/blacklist.js';
import { init as initFG,       handlers as fgHandlers       } from './providers/focus-guard.js';
import { init as initProxy,    handlers as proxyHandlers,
         handleProxyAction                                   } from './providers/proxy.js';

(async () => {
  await Promise.all([
    initBrowser(),
    initWebRTC(),
    initUA(),
    initBL(),
    initFG(),
    initProxy(),
  ]);

  const allHandlers = {
    ...browserHandlers,
    ...webrtcHandlers,
    ...uaHandlers,
    ...blHandlers,
    ...fgHandlers,
    ...proxyHandlers,
  };

  chrome.runtime.onMessage.addListener((msg, sender, respond) => {
    if (!msg?.type) return;

    // Dynamic proxy:switch:<name> actions from the command palette
    const dynamicHandler = handleProxyAction(msg.type);
    const handler = dynamicHandler ?? allHandlers[msg.type];

    if (!handler) return;

    handler(msg, sender)
      .then(respond)
      .catch(err => {
        console.error('[Nexus] Handler error for', msg.type, err);
        respond({ ok: false, error: String(err) });
      });

    return true; // keep channel open for async response
  });

  // Open command palette on keyboard shortcut or toolbar click
  chrome.commands.onCommand.addListener(async (command) => {
    if (command === 'open-nexus') {
      await browserHandlers['browser:open-nexus']();
    }
  });

  chrome.action.onClicked.addListener(async () => {
    await browserHandlers['browser:open-nexus']();
  });
})();
