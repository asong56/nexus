// ticker.js — offscreen document ticker (MPL 2.0, derived from LeechBlock NG)
// Sends fg:tick to the service worker at a configurable interval.
// Running in offscreen document avoids service worker sleep issues.

let gTickerID;
let gTickerSecs = 1;

gTickerID = window.setInterval(onInterval, gTickerSecs * 1000);

chrome.runtime.onMessage.addListener((message) => {
  if (message.type === 'fg:ticker-config') {
    const secs = message.tickerSecs;
    if (secs && secs !== gTickerSecs) {
      gTickerSecs = secs;
      window.clearInterval(gTickerID);
      gTickerID = window.setInterval(onInterval, gTickerSecs * 1000);
    }
  }
});

function onInterval() {
  chrome.runtime.sendMessage({ type: 'fg:tick' });
}
