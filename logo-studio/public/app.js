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

  let files = [];
  let pollTimer = null;
  let currentJob = null;

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

  function render(job) {
    const done = job.samples.filter((s) => s.status === 'done').length;
    const settled = job.samples.filter((s) => s.status !== 'pending').length;
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

  function poll(jobId, attempt = 0, failures = 0) {
    clearTimeout(pollTimer);
    pollTimer = setTimeout(async () => {
      try {
        const res = await fetch(`api/jobs/${jobId}`, { cache: 'no-store' });
        const data = await res.json().catch(() => ({}));
        if (!res.ok) throw Object.assign(new Error(data.error || 'Falha ao consultar'), { fatal: res.status === 404 });
        if (jobId !== currentJob) return;
        render(data);
        if (data.state === 'done' || data.state === 'error') { setBusy(false); return; }
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

    const body = new FormData();
    body.append('prompt', text);
    body.append('transparent', transparent.checked ? 'true' : 'false');
    files.forEach((f) => body.append('images', f.file, f.file.name));

    setBusy(true);
    try {
      const res = await fetch('api/generate', { method: 'POST', body });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Não foi possível iniciar a geração.');
      currentJob = data.id;
      results.hidden = false;
      buildCards(data.samples.length);
      render(data);
      results.scrollIntoView({ behavior: 'smooth', block: 'start' });
      poll(data.id);
    } catch (err) {
      showError(err.message === 'Failed to fetch' ? 'Sem conexão com o servidor.' : err.message);
      setBusy(false);
    }
  });
})();
