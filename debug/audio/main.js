import { installBrand, WORDMARK_HTML } from '../../src/ui/brand.js';

installBrand();

const style = document.createElement('style');
style.textContent = `
  html, body { margin: 0; background: var(--wm-bg); color: var(--wm-fg); font-family: var(--wm-body); }
  #app { max-width: 960px; margin: 0 auto; padding: 32px 24px 96px; }
  .wm-header { display: flex; align-items: baseline; gap: 16px; margin-bottom: 4px; }
  .wm-mark { font-size: 32px; }
  .wm-sub { color: var(--wm-muted-fg); font-size: 14px; margin-bottom: 28px; }
  .wm-group { margin-bottom: 28px; }
  .wm-group h2 { font-family: var(--wm-display); font-weight: 400; letter-spacing: .04em; text-transform: uppercase;
    font-size: 20px; color: var(--wm-fg); border-bottom: 1px solid var(--wm-border); padding-bottom: 8px; margin-bottom: 12px; }
  .wm-subgroup { margin-bottom: 16px; }
  .wm-subgroup h3 { font-size: 12px; text-transform: uppercase; letter-spacing: .06em; color: var(--wm-muted-fg);
    margin: 0 0 8px; font-weight: 600; }
  .wm-rows { display: flex; flex-direction: column; gap: 6px; }
  .wm-row { display: flex; align-items: center; gap: 10px; background: var(--wm-panel); border: 1px solid var(--wm-border);
    border-radius: var(--wm-r-sm); padding: 8px 10px; transition: border-color var(--wm-t); }
  .wm-row:hover { border-color: var(--wm-accent); }
  .wm-row button { appearance: none; border: none; border-radius: var(--wm-r-sm); background: var(--wm-fg); color: var(--wm-graphite, #181c28);
    font: inherit; font-weight: 600; font-size: 13px; padding: 6px 14px; cursor: pointer; transition: background var(--wm-t); }
  .wm-row button:hover { background: var(--wm-fg-warm); }
  .wm-row button.playing { background: var(--wm-accent); }
  .wm-row .name { font-size: 13px; color: var(--wm-fg-dim); flex: 1; font-family: monospace; }
  .wm-row .dur { font-size: 12px; color: var(--wm-muted-fg); font-variant-numeric: tabular-nums; width: 42px; text-align: right; }
  .wm-controls { position: sticky; top: 0; z-index: 1; background: var(--wm-bg); padding: 12px 0; margin-bottom: 12px;
    display: flex; align-items: center; gap: 12px; border-bottom: 1px solid var(--wm-border); }
  .wm-controls label { font-size: 13px; color: var(--wm-muted-fg); display: flex; align-items: center; gap: 6px; }
  .wm-controls input[type="range"] { accent-color: var(--wm-accent); }
  .wm-controls input[type="text"] { background: var(--wm-panel-2); border: 1px solid var(--wm-border); color: var(--wm-fg);
    border-radius: var(--wm-r-sm); padding: 6px 10px; font: inherit; font-size: 13px; flex: 1; }
  .wm-empty { color: var(--wm-muted-fg); font-size: 13px; padding: 24px 0; }
`;
document.head.appendChild(style);

const app = document.getElementById('app');
app.innerHTML = `
  <div class="wm-header"><span class="wm-mark">${WORDMARK_HTML}</span><span>Audio Debug</span></div>
  <div class="wm-sub">/debug/audio — plays raw files from public/sfx via the manifest. Nothing here touches the game's mixer.</div>
  <div class="wm-controls">
    <input type="text" id="filter" placeholder="Filter (e.g. shot/ak, footstep, wood)" />
    <label>Vol <input type="range" id="vol" min="0" max="1" step="0.01" value="0.8" /></label>
  </div>
  <div id="groups"></div>
`;

const groupsEl = document.getElementById('groups');
const filterEl = document.getElementById('filter');
const volEl = document.getElementById('vol');

let manifest = {};
let currentAudio = null;
let currentBtn = null;

function stopCurrent() {
  if (currentAudio) {
    currentAudio.pause();
    currentAudio.currentTime = 0;
  }
  if (currentBtn) currentBtn.classList.remove('playing');
  currentAudio = null;
  currentBtn = null;
}

function play(path, btn) {
  stopCurrent();
  const audio = new Audio(`/sfx/${path}`);
  audio.volume = Number(volEl.value);
  audio.addEventListener('ended', () => {
    if (currentAudio === audio) stopCurrent();
  });
  audio.play().catch((err) => console.warn('playback failed', path, err));
  currentAudio = audio;
  currentBtn = btn;
  btn.classList.add('playing');
}

function render(filterText) {
  const q = filterText.trim().toLowerCase();
  groupsEl.innerHTML = '';
  let any = false;

  for (const [category, subgroups] of Object.entries(manifest)) {
    const groupEl = document.createElement('div');
    groupEl.className = 'wm-group';
    let groupHasMatch = false;
    let groupHtml = `<h2>${category}</h2>`;

    for (const [sub, files] of Object.entries(subgroups)) {
      const matched = files.filter((f) => !q || `${category}/${sub}/${f}`.toLowerCase().includes(q));
      if (!matched.length) continue;
      groupHasMatch = true;
      groupHtml += `<div class="wm-subgroup"><h3>${sub}</h3><div class="wm-rows" data-sub="${category}/${sub}"></div></div>`;
    }

    if (!groupHasMatch) continue;
    any = true;
    groupEl.innerHTML = groupHtml;
    groupsEl.appendChild(groupEl);

    for (const [sub, files] of Object.entries(subgroups)) {
      const matched = files.filter((f) => !q || `${category}/${sub}/${f}`.toLowerCase().includes(q));
      if (!matched.length) continue;
      const rowsEl = groupEl.querySelector(`[data-sub="${category}/${sub}"]`);
      for (const path of matched) {
        const row = document.createElement('div');
        row.className = 'wm-row';
        row.innerHTML = `<button type="button">▶</button><span class="name">${path}</span>`;
        const btn = row.querySelector('button');
        btn.addEventListener('click', () => {
          if (currentBtn === btn) return stopCurrent();
          play(path, btn);
        });
        rowsEl.appendChild(row);
      }
    }
  }

  if (!any) {
    groupsEl.innerHTML = '<div class="wm-empty">No sounds match that filter.</div>';
  }
}

filterEl.addEventListener('input', () => render(filterEl.value));
volEl.addEventListener('input', () => {
  if (currentAudio) currentAudio.volume = Number(volEl.value);
});

fetch('/sfx/manifest.json')
  .then((res) => res.json())
  .then((data) => {
    manifest = data;
    render('');
  })
  .catch((err) => {
    groupsEl.innerHTML = `<div class="wm-empty">Failed to load manifest.json: ${err}</div>`;
  });
