(() => {
  'use strict';
  let loading = false;
  let redirected = false;
  function openVideo() {
    const configured = typeof window.CUIDADO_VIDEO_URL === 'string' ? window.CUIDADO_VIDEO_URL.trim() : '';
    if (!configured || redirected) return;
    let destination;
    try { destination = new URL(configured); } catch { return; }
    if (destination.protocol !== 'https:' || destination.username || destination.password || destination.origin === location.origin) return;
    redirected = true;
    document.querySelector('#video-status').textContent = 'Vídeo disponível';
    document.querySelector('#video-title').textContent = 'Abrindo a demonstração…';
    document.querySelector('#video-description').textContent = 'Se o vídeo não abrir, use o botão abaixo.';
    const link = document.querySelector('#video-link');
    link.href = destination.href;
    link.hidden = false;
    location.replace(destination.href);
  }
  function refresh() {
    if (loading || redirected || document.hidden) return;
    loading = true;
    const script = document.createElement('script');
    script.src = '/video-demo/config.js?v=' + Date.now();
    script.onload = () => { loading = false; script.remove(); openVideo(); };
    script.onerror = () => { loading = false; script.remove(); };
    document.head.append(script);
  }
  openVideo();
  refresh();
  setInterval(refresh, 15000);
  document.addEventListener('visibilitychange', refresh);
})();
