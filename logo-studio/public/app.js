(() => {
  'use strict';

  const MAX_FILES = 3;
  const MAX_BYTES = 8 * 1024 * 1024;
  const TYPES = ['image/png', 'image/jpeg', 'image/webp'];
  const SAMPLES = 5;

  const $ = (sel) => document.querySelector(sel);
  const form = $('#form');
  const prompt = $('#prompt');
  const count = $('#count');
  const drop = $('#drop');
  const input = $('#images');
  const thumbs = $('#thumbs');
  const transparent = $('#transparent');
  const submit = $('#submit');
  const errorBox = $('#error');
  const results = $('#results');
  const grid = $('#grid');
  const status = $('#status');
  const bar = $('#bar');
  const tpl = $('#card-tpl');
  const continueBtn = $('#continue');

  const PUTER_SRC = 'https://js.puter.com/v2/';

  let files = [];
  let pollTimer = null;
  let currentJob = null;
  let serverMode = 'server';
  let pendingClientJob = null;

  // ---------- Texto ----------
  const updateCount = () => { count.textContent = `${prompt.value.length}/${prompt.maxLength}`; };
  prompt.addEventListener('input', updateCount);
  updateCount();

  // ---------- Upload ----------
  function showError(msg) {
    errorBox.textContent = msg || '';
    errorBox.hidden = !msg;
  }

  function addFiles(list) {
    showError('');
    for (const file of list) {
      if (files.length >= MAX_FILES) { showError(`Envie no máximo ${MAX_FILES} imagens.`); break; }
      if (!TYPES.includes(file.type)) { showError('Use imagens PNG, JPG ou WebP.'); continue; }
      if (file.size > MAX_BYTES) { showError('Cada imagem pode ter no máximo 8 MB.'); continue; }
      files.push({ file, url: URL.createObjectURL(file) });
    }
    renderThumbs();
  }

  function renderThumbs() {
    thumbs.replaceChildren(...files.map((item, i) => {
      const li = document.createElement('li');
      const img = document.createElement('img');
      img.src = item.url;
      img.alt = `Referência ${i + 1}`;
      const rm = document.createElement('button');
      rm.type = 'button';
      rm.textContent = '×';
      rm.title = 'Remover';
      rm.setAttribute('aria-label', `Remover referência ${i + 1}`);
      rm.addEventListener('click', () => {
        URL.revokeObjectURL(item.url);
        files.splice(i, 1);
        renderThumbs();
      });
      li.append(img, rm);
      return li;
    }));
  }

  drop.addEventListener('click', () => input.click());
  drop.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); input.click(); }
  });
  input.addEventListener('change', () => { addFiles(input.files); input.value = ''; });
  ['dragenter', 'dragover'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.add('over'); }));
  ['dragleave', 'drop'].forEach((ev) => drop.addEventListener(ev, (e) => { e.preventDefault(); drop.classList.remove('over'); }));
  drop.addEventListener('drop', (e) => addFiles(e.dataTransfer.files));
  document.addEventListener('paste', (e) => {
    const pasted = [...(e.clipboardData?.files || [])].filter((f) => f.type.startsWith('image/'));
    if (pasted.length) addFiles(pasted);
  });

  // ---------- Resultados ----------
  const sampleUrl = (jobId, i, ext, download) => `api/jobs/${jobId}/samples/${i}.${ext}${download ? '?download=1' : ''}`;

  function buildCards(n) {
    grid.replaceChildren();
    for (let i = 0; i < n; i += 1) {
      const node = tpl.content.firstElementChild.cloneNode(true);
      node.querySelector('.title').textContent = `Opção ${i + 1}`;
      node.querySelectorAll('.bgs button').forEach((btn) => btn.addEventListener('click', () => {
        const preview = node.querySelector('.preview');
        preview.classList.remove('checker', 'light', 'dark');
        preview.classList.add(btn.dataset.bg);
        node.querySelectorAll('.bgs button').forEach((b) => b.classList.toggle('on', b === btn));
      }));
      grid.append(node);
    }
  }

  function updateCard(jobId, sample) {
    const card = grid.children[sample.index];
    if (!card) return;
    if (sample.title) card.querySelector('.title').textContent = sample.title;
    if (sample.description) card.querySelector('.desc').textContent = sample.description;
    const sw = card.querySelector('.swatches');
    if (sample.palette?.length && !sw.childElementCount) {
      sample.palette.forEach((c) => {
        const s = document.createElement('span');
        s.style.background = c;
        s.title = c;
        sw.append(s);
      });
    }
    if (sample.status === 'done' && !card.dataset.loaded) {
      card.dataset.loaded = '1';
      const img = card.querySelector('.preview img');
      img.alt = sample.title ? `Logo: ${sample.title}` : `Logo opção ${sample.index + 1}`;
      img.onload = () => { img.hidden = false; card.querySelector('.skeleton').hidden = true; };
      img.onerror = () => {
        card.classList.add('failed');
        card.querySelector('.skeleton .small').textContent = 'Não foi possível carregar esta opção.';
      };
      img.src = sampleUrl(jobId, sample.index, 'svg');
      const svg = card.querySelector('.dl-svg');
      const png = card.querySelector('.dl-png');
      svg.href = sampleUrl(jobId, sample.index, 'svg', true);
      png.href = sampleUrl(jobId, sample.index, 'png', true);
      svg.setAttribute('aria-disabled', 'false');
      png.setAttribute('aria-disabled', 'false');
    }
    if (sample.status === 'error' && !card.classList.contains('failed')) {
      card.classList.add('failed');
      card.querySelector('.skeleton .small').textContent = 'Não foi possível gerar esta opção.';
    }
  }

  const isSettled = (st) => st === 'done' || st === 'error';

  function render(job) {
    const done = job.samples.filter((s) => s.status === 'done').length;
    const settled = job.samples.filter((s) => isSettled(s.status)).length;
    job.samples.forEach((s) => updateCard(job.id, s));

    let pct = 3;
    if (job.state === 'queued') {
      status.textContent = job.position > 1 ? `Na fila (posição ${job.position})…` : 'Preparando…';
    } else if (job.stage === 'concepts') {
      status.textContent = 'Criando os conceitos da sua marca…';
      pct = 12;
    } else if (job.stage === 'images') {
      status.textContent = `Desenhando as logos… ${done}/${job.samples.length}`;
      pct = 20 + (80 * settled) / job.samples.length;
    }
    if (job.state === 'done') {
      status.textContent = done === job.samples.length ? 'Pronto! Escolha sua favorita e baixe.' : `Pronto: ${done} de ${job.samples.length} opções geradas.`;
      pct = 100;
    }
    if (job.state === 'error') {
      status.textContent = job.error || 'Não foi possível gerar agora.';
      pct = 100;
    }
    bar.style.width = `${pct}%`;
  }

  function setBusy(busy) {
    submit.disabled = busy;
    const label = submit.querySelector('.btn-label');
    submit.querySelector('.spinner')?.remove();
    if (busy) {
      const sp = document.createElement('span');
      sp.className = 'spinner';
      submit.prepend(sp);
      label.textContent = 'Gerando…';
    } else {
      label.textContent = currentJob ? 'Gerar novamente' : `Gerar ${SAMPLES} logos`;
    }
  }

  async function api(path, options) {
    const res = await fetch(path, { cache: 'no-store', ...options });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw Object.assign(new Error(data.error || 'Falha na comunicação.'), { status: res.status });
    return data;
  }

  // ---------- Modo gratuito no navegador (cota do visitante) ----------
  let puterLoading = null;
  function loadPuter() {
    if (window.puter) return Promise.resolve(window.puter);
    puterLoading ??= new Promise((resolve, reject) => {
      const el = document.createElement('script');
      el.src = PUTER_SRC;
      el.async = true;
      el.onload = () => (window.puter ? resolve(window.puter) : reject(new Error('indisponível')));
      el.onerror = () => { puterLoading = null; reject(new Error('indisponível')); };
      document.head.append(el);
    });
    return puterLoading;
  }

  // Precisa ser chamada dentro do clique: o login abre uma janela rápida (conta temporária, sem cadastro).
  function ensureSignedIn() {
    if (!window.puter) return loadPuter().then(() => ensureSignedIn());
    if (window.puter.auth.isSignedIn()) return Promise.resolve();
    return window.puter.auth.signIn({ attempt_temp_user_creation: true });
  }

  const errorText = (e) => {
    try { return `${e?.code || ''} ${e?.message || ''} ${JSON.stringify(e)}`; } catch { return String(e); }
  };
  const isFunds = (e) => /insufficient_funds|402/.test(errorText(e));
  const isPopupIssue = (e) => /popup_blocked|auth_window_closed/.test(errorText(e));

  let refsCache = null;
  async function refsDataUrls() {
    if (refsCache) return refsCache;
    refsCache = await Promise.all(files.map(async ({ file }) => {
      const bmp = await createImageBitmap(file);
      const scale = Math.min(1, 1024 / Math.max(bmp.width, bmp.height));
      const canvas = document.createElement('canvas');
      canvas.width = Math.round(bmp.width * scale);
      canvas.height = Math.round(bmp.height * scale);
      canvas.getContext('2d').drawImage(bmp, 0, 0, canvas.width, canvas.height);
      return canvas.toDataURL('image/png');
    }));
    return refsCache;
  }

  const messageText = (resp) => {
    const c = resp?.message?.content;
    if (typeof c === 'string') return c;
    if (Array.isArray(c)) return c.map((b) => b?.text || '').join('');
    return typeof resp === 'string' ? resp : String(resp ?? '');
  };

  async function clientConcepts(job) {
    const { client } = job;
    const opts = { model: client.textModel, reasoning_effort: 'low' };
    const refs = await refsDataUrls();
    let text = '';
    try {
      const resp = refs.length
        ? await window.puter.ai.chat(client.prompt, refs, false, opts).catch((e) => {
          if (isFunds(e)) throw e;
          return window.puter.ai.chat(client.prompt, opts); // sem as referências
        })
        : await window.puter.ai.chat(client.prompt, opts);
      text = messageText(resp);
    } catch (e) {
      if (isFunds(e)) throw e;
      text = ''; // o servidor completa com conceitos próprios
    }
    return api(`api/jobs/${job.id}/concepts`, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text }),
    });
  }

  function dataUrlToBlob(src) {
    const [head, b64] = src.split(',', 2);
    const type = (head.match(/^data:([^;,]+)/) || [, 'image/png'])[1];
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i += 1) bytes[i] = bin.charCodeAt(i);
    return new Blob([bytes], { type });
  }

  async function imageBody(src) {
    if (/^(data|blob):/.test(src)) {
      const fd = new FormData();
      fd.append('image', src.startsWith('data:') ? dataUrlToBlob(src) : await (await fetch(src)).blob(), 'logo.png');
      return { body: fd };
    }
    try {
      const blob = await (await fetch(src, { mode: 'cors' })).blob();
      const fd = new FormData();
      fd.append('image', blob, 'logo.png');
      return { body: fd };
    } catch {
      return { headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ url: src }) };
    }
  }

  async function clientImage(job, { index, prompt: imagePrompt }) {
    const { client } = job;
    const refs = await refsDataUrls();
    const opts = { model: client.imageModel, quality: client.quality };
    const path = `api/jobs/${job.id}/samples/${index}/image`;
    for (let attempt = 0; attempt < 2; attempt += 1) {
      try {
        let img;
        try {
          img = await window.puter.ai.txt2img(imagePrompt, refs.length && attempt === 0 ? { ...opts, input_images: refs } : opts);
        } catch (e) {
          if (isFunds(e) || !refs.length || attempt > 0) throw e;
          img = await window.puter.ai.txt2img(imagePrompt, opts);
        }
        const data = await api(path, { method: 'POST', ...(await imageBody(img.src)) });
        if (job.id === currentJob) render(data);
        return data;
      } catch (e) {
        if (isFunds(e)) throw e;
        if (attempt > 0) break;
      }
    }
    const data = await api(path, {
      method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ failed: true }),
    }).catch(() => null);
    if (data && job.id === currentJob) render(data);
    return data;
  }

  function askToContinue(job, message) {
    pendingClientJob = job;
    status.textContent = message;
    continueBtn.hidden = false;
    setBusy(false);
  }

  continueBtn.addEventListener('click', () => {
    const job = pendingClientJob;
    if (!job) return;
    continueBtn.hidden = true;
    setBusy(true);
    runClient(job, ensureSignedIn());
  });

  async function runClient(job, signIn) {
    pendingClientJob = null;
    status.textContent = 'Liberando sua geração gratuita…';
    try {
      await loadPuter();
      await (signIn || ensureSignedIn());
    } catch (e) {
      askToContinue(job, isPopupIssue(e)
        ? 'Clique em "Continuar geração" e permita a janela rápida de acesso gratuito.'
        : 'Não foi possível iniciar a geração gratuita. Clique em "Continuar geração" para tentar de novo.');
      return;
    }
    try {
      let state = job;
      if (state.client.stage === 'concepts') {
        render(state);
        state = await clientConcepts(state);
        if (state.id === currentJob) render(state);
      }
      await Promise.all((state.client?.prompts || []).map((p) => clientImage(state, p)));
      const final = await api(`api/jobs/${state.id}`);
      if (final.id === currentJob) render(final);
    } catch (e) {
      status.textContent = isFunds(e)
        ? 'A cota gratuita de IA deste navegador acabou. Tente novamente mais tarde.'
        : (e.message || 'Não foi possível concluir a geração.');
    } finally {
      if (job.id === currentJob) setBusy(false);
      refreshStatus();
    }
  }

  async function refreshStatus() {
    try {
      serverMode = (await api('api/status')).mode;
      if (serverMode === 'client') loadPuter().catch(() => {});
    } catch { /* mantém o último modo conhecido */ }
  }

  // ---------- Fluxo principal ----------
  function poll(jobId, attempt = 0, failures = 0) {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(async () => {
      try {
        const data = await api(`api/jobs/${jobId}`).catch((err) => { throw Object.assign(err, { fatal: err.status === 404 }); });
        if (jobId !== currentJob) return;
        render(data);
        if (data.state === 'done' || data.state === 'error') { setBusy(false); return; }
        if (data.state === 'client') {
          // A cota do servidor acabou no meio: continua no navegador (sem janela se já houver acesso).
          if (window.puter?.auth.isSignedIn()) runClient(data);
          else { loadPuter().catch(() => {}); askToContinue(data, 'Falta pouco! Clique em "Continuar geração" para terminar suas logos gratuitamente.'); }
          return;
        }
        poll(jobId, attempt + 1, 0);
      } catch (err) {
        if (err.fatal || failures >= 20) {
          status.textContent = err.message || 'Conexão perdida. Tente novamente.';
          setBusy(false);
          return;
        }
        poll(jobId, attempt + 1, failures + 1);
      }
    }, Math.min(1200 + attempt * 150, 3000));
  }

  form.addEventListener('submit', async (e) => {
    e.preventDefault();
    showError('');
    const text = prompt.value.trim();
    if (text.length < 3) { showError('Descreva a logo que você quer.'); prompt.focus(); return; }

    // Ainda dentro do clique: prepara o acesso gratuito se o próximo pedido for rodar no navegador.
    let signIn = null;
    if (serverMode === 'client' && window.puter) {
      signIn = ensureSignedIn();
      signIn.catch(() => {});
    }

    const body = new FormData();
    body.append('prompt', text);
    body.append('transparent', transparent.checked ? 'true' : 'false');
    files.forEach((f) => body.append('images', f.file, f.file.name));
    refsCache = null;
    continueBtn.hidden = true;
    pendingClientJob = null;

    setBusy(true);
    try {
      const data = await api('api/generate', { method: 'POST', body });
      currentJob = data.id;
      results.hidden = false;
      buildCards(data.samples.length);
      render(data);
      results.scrollIntoView({ behavior: 'smooth', block: 'start' });
      if (data.state === 'client') runClient(data, signIn);
      else poll(data.id);
    } catch (err) {
      showError(err.message === 'Failed to fetch' ? 'Sem conexão com o servidor.' : err.message);
      setBusy(false);
    }
  });

  refreshStatus();
})();
