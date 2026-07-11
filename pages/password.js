const params     = new URLSearchParams(location.search);
const blockedURL = params.get('url') ? decodeURIComponent(params.get('url')) : '';
const blockedSet = params.get('set') || '1';

document.getElementById('btn-submit').addEventListener('click', tryPassword);
document.getElementById('pw').addEventListener('keydown', e => { if (e.key === 'Enter') tryPassword(); });
document.getElementById('btn-back').addEventListener('click', () => history.back());

function tryPassword() {
  const pw = document.getElementById('pw').value;
  chrome.runtime.sendMessage({ type: 'fg:password', password: pw, blockedURL, blockedSet }).then(res => {
    if (res?.ok) {

    } else {
      document.getElementById('error').textContent = 'Incorrect password.';
      document.getElementById('pw').value = '';
      document.getElementById('pw').focus();
    }
  }).catch(() => {
    document.getElementById('error').textContent = 'Error checking password.';
  });
}
document.getElementById('pw').focus();
