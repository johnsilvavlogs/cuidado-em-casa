(() => {
  'use strict';
  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => [...root.querySelectorAll(selector)];
  const state = { role: 'helena', walk: false, sleep: false, proposal: null };
  const roles = $$('[data-role]');
  const singlePhone = matchMedia('(max-width: 600px)');
  const proposalDialog = $('#proposal-dialog');
  const availabilityDialog = $('#availability-dialog');
  const announcement = $('#preview-status');
  let dialogTrigger;
  function announce(message) { announcement.textContent = message; }
  function selectRole(role, focus = false) {
    state.role = role;
    $('.role-switch').dataset.selected = role;
    $('.phones').dataset.currentRole = role;
    roles.forEach(button => {
      const selected = button.dataset.role === role;
      button.setAttribute('aria-pressed', String(selected));
      button.classList.toggle('is-selected', selected);
      if (selected && focus) button.focus();
    });
    announce(`Perspectiva de ${role === 'helena' ? 'Helena' : 'Marina'}. ${state.walk ? 'Caminhada feita, registrada por Helena às 9h12.' : 'Caminhada sem registro.'}`);
  }
  function focusPreview() {
    const target = singlePhone.matches
      ? roles.find(button => button.dataset.role === state.role)
      : $('[data-propose]:not(:disabled)');
    target?.focus({ preventScroll: true });
  }
  singlePhone.addEventListener('change', () => {
    const active = document.activeElement;
    if (active.closest('#previa') && !active.getClientRects().length) focusPreview();
  });
  function render() {
    $$('[data-walk-status]').forEach(el => { el.textContent = state.walk ? 'Feita' : 'Sem registro'; el.classList.toggle('is-done', state.walk); });
    $$('[data-attribution]').forEach(el => { el.hidden = !state.walk; });
    const walking = $('[data-propose="walk"]');
    walking.textContent = state.walk ? 'Registrada nesta prévia' : 'Registrar caminhada';
    walking.disabled = state.walk;
    $('[data-caregiver-summary]').textContent = state.walk ? 'Registro atualizado nesta prévia. Helena confirmou a caminhada.' : 'O registro de Helena aparece aqui depois da confirmação.';
    $('[data-caregiver-sleep]').textContent = state.sleep ? 'Pouco · registrado por Helena · 9h12' : 'Ainda não informado';
    $('[data-sleep-status]').hidden = !state.sleep;
    $('[data-sleep-status]').textContent = state.sleep ? 'Sono atualizado nesta prévia.' : '';
  }
  roles.forEach((button, index) => {
    button.addEventListener('click', () => selectRole(button.dataset.role));
    button.addEventListener('keydown', event => {
      if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? roles.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + roles.length) % roles.length;
      selectRole(roles[next].dataset.role, true);
    });
  });
  $$('[data-propose]').forEach(button => button.addEventListener('click', () => {
    state.proposal = button.dataset.propose;
    dialogTrigger = button;
    $('#proposal-text').textContent = state.proposal === 'walk' ? 'Caminhada leve, às 9h: feita.' : 'Sono de hoje: pouco.';
    proposalDialog.returnValue = "";
    proposalDialog.showModal();
    $('.dialog-close', proposalDialog).focus();
  }));
  $('#confirm-preview').addEventListener('click', () => {
    if (state.proposal === 'walk') state.walk = true;
    if (state.proposal === 'sleep') state.sleep = true;
    render();
    proposalDialog.close('confirmed');
    announce('Registro atualizado nesta prévia. Registrado por Helena às 9h12. A perspectiva de Marina também foi atualizada.');
  });
  proposalDialog.addEventListener('close', () => {
    const confirmed = proposalDialog.returnValue === 'confirmed';
    state.proposal = null;
    if (!confirmed) announce('Proposta cancelada. Nenhum registro foi alterado.');
    if (dialogTrigger?.disabled) focusPreview();
    else dialogTrigger?.focus();
  });
  $('[data-reset]').addEventListener('click', () => {
    state.walk = false; state.sleep = false; state.proposal = null; render();
    announce('Prévia reiniciada. Caminhada sem registro. Sono ainda não informado.');
  });
  function resolveDestination() {
    const configured = typeof window.CUIDADO_CONFIG?.appUrl === 'string' ? window.CUIDADO_CONFIG.appUrl.trim() : '';
    if (configured) {
      try { const url = new URL(configured); if (url.protocol === 'https:' && !url.username && !url.password) return url.href; } catch { /* Invalid config keeps the truthful availability fallback. */ }
    }
    if (['localhost', '127.0.0.1', '[::1]'].includes(location.hostname)) return 'http://127.0.0.1:3000/';
    return null;
  }
  const destination = resolveDestination();
  $$('[data-app-link]').forEach(link => {
    if (destination) link.href = destination;
    else link.addEventListener('click', event => {
      event.preventDefault(); dialogTrigger = link; availabilityDialog.returnValue = ""; availabilityDialog.showModal(); $('.dialog-close', availabilityDialog).focus();
    });
  });
  availabilityDialog.addEventListener('close', () => { if (availabilityDialog.returnValue !== 'explore') dialogTrigger?.focus(); });
  $('#explore-preview').addEventListener('click', () => {
    availabilityDialog.close('explore');
    $('#previa').scrollIntoView({ behavior: matchMedia('(prefers-reduced-motion: reduce)').matches ? 'instant' : 'smooth', block: 'start' });
    focusPreview();
  });
  render();
  if ('IntersectionObserver' in window && !matchMedia('(prefers-reduced-motion: reduce)').matches) {
    const observer = new IntersectionObserver(entries => {
      entries.forEach(entry => { if (entry.isIntersecting) { entry.target.classList.add('is-visible'); observer.unobserve(entry.target); } });
    }, { rootMargin: '0px 0px -25px 0px', threshold: 0.06 });
    $$('[data-reveal]').forEach((element, index) => {
      element.classList.add('will-reveal');
      element.style.setProperty('--reveal-delay', `${(index % 3) * 65}ms`);
      observer.observe(element);
    });
  }
  document.addEventListener('visibilitychange', () => document.documentElement.classList.toggle('motion-paused', document.hidden));
})();
