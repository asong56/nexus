// inject/webrtc-block.js
// Derived from WebRTCControl-1.2.0 inject-webrtc-block.js
// Injected into MAIN world at document_start when full WebRTC blocking is active.
// Overrides RTCPeerConnection so all WebRTC connections throw immediately.
(() => {
  ['RTCPeerConnection', 'webkitRTCPeerConnection'].forEach(name => {
    const original = self[name];
    if (!original) return;
    const blocked = function () { throw new Error('WebRTC blocked by Nexus'); };
    try { Object.defineProperty(blocked, 'name', { value: original.name }); } catch {}
    try { Object.defineProperty(blocked, 'length', { value: original.length }); } catch {}
    try { Object.setPrototypeOf(blocked, Object.getPrototypeOf(original)); } catch {}
    try { Object.defineProperty(self, name, { configurable: false, writable: false, value: blocked }); }
    catch { self[name] = blocked; }
  });

  // Block getUserMedia
  try {
    if (navigator?.mediaDevices?.getUserMedia) {
      Object.defineProperty(navigator.mediaDevices, 'getUserMedia', {
        value: () => Promise.reject(new Error('WebRTC getUserMedia blocked by Nexus')),
      });
    }
  } catch {}
  try {
    if (typeof navigator.getUserMedia === 'function') {
      navigator.getUserMedia = () => { throw new Error('WebRTC getUserMedia blocked by Nexus'); };
    }
  } catch {}

  // Block prototype methods
  const proto = self.RTCPeerConnection?.prototype || self.webkitRTCPeerConnection?.prototype;
  if (proto) {
    for (const method of ['createDataChannel','addIceCandidate','setLocalDescription','setRemoteDescription','createOffer','createAnswer']) {
      if (proto[method]) {
        try { Object.defineProperty(proto, method, { value: () => { throw new Error('WebRTC blocked by Nexus'); } }); } catch {}
      }
    }
  }
})();
