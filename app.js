// ---------- 状態管理 ----------
const STORAGE_KEY = 'relationMapData_v1';

function uid(prefix) {
  return prefix + '_' + Math.random().toString(36).slice(2, 9);
}

function escapeHtml(str) {
  return String(str).replace(/[&<>"']/g, c => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  }[c]));
}

function seedState() {
  const n = (label, x, y, children = []) => ({ id: uid('node'), label, x, y, children });
  const reception = n('受付', 120, 120);
  const audit1 = n('処方監査', 380, 120);
  const dispense = n('調剤', 640, 120, [
    { id: uid('item'), label: 'ピッキング', children: [] },
    { id: uid('item'), label: '一包化', children: [] },
    { id: uid('item'), label: '軟膏', children: [] },
    { id: uid('item'), label: '散剤', children: [] },
  ]);
  const audit2 = n('監査', 900, 120);
  const medication = n('投薬', 1160, 120);
  const input = n('入力', 120, 320);
  const stock = n('在庫', 640, 320);
  const nodes = [reception, audit1, dispense, audit2, medication, input, stock];
  const e = (from, to) => ({ id: uid('edge'), from: from.id, to: to.id });
  const edges = [
    e(reception, audit1),
    e(audit1, dispense),
    e(dispense, audit2),
    e(audit2, medication),
    e(reception, input),
    e(dispense, stock),
  ];
  return { nodes, edges };
}

function loadState() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw);
      if (parsed && Array.isArray(parsed.nodes) && Array.isArray(parsed.edges)) return parsed;
    }
  } catch (e) { /* 壊れたデータは無視して初期データへ */ }
  return seedState();
}

let state = loadState();

let saveTimer = null;
function scheduleSave() {
  const ind = document.getElementById('save-indicator');
  ind.textContent = '保存中...';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    if (currentUser && cloudDb) {
      cloudDb.collection('maps').doc(currentUser.uid).set(state)
        .then(() => { ind.textContent = '保存済み（クラウド）'; })
        .catch(() => { ind.textContent = '保存済み（ローカルのみ・通信エラー）'; });
    } else {
      ind.textContent = '保存済み';
    }
  }, 300);
}

// ---------- ログイン（Firebase） ----------
let currentUser = null;
let cloudDb = null;
let cloudAuth = null;

function isFirebaseConfigured() {
  return !!(window.firebaseConfig && window.firebaseConfig.apiKey && window.firebaseConfig.apiKey !== 'YOUR_API_KEY');
}

function initAuth() {
  const loginBtn = document.getElementById('btn-login');
  const logoutBtn = document.getElementById('btn-logout');

  if (!isFirebaseConfigured()) {
    loginBtn.addEventListener('click', () => {
      alert('ログイン機能を使うには、firebase-config.js に Firebase プロジェクトの設定を貼り付けてください。');
    });
    return;
  }

  firebase.initializeApp(window.firebaseConfig);
  cloudAuth = firebase.auth();
  cloudDb = firebase.firestore();

  cloudAuth.onAuthStateChanged((user) => {
    currentUser = user;
    updateAuthUI();
    if (user) loadFromCloud(user.uid);
  });

  loginBtn.addEventListener('click', () => {
    const provider = new firebase.auth.GoogleAuthProvider();
    cloudAuth.signInWithPopup(provider).catch((err) => {
      alert('ログインに失敗しました: ' + err.message);
    });
  });
  logoutBtn.addEventListener('click', () => {
    cloudAuth.signOut();
  });
}

function updateAuthUI() {
  const loginBtn = document.getElementById('btn-login');
  const userBadge = document.getElementById('user-badge');
  if (currentUser) {
    loginBtn.style.display = 'none';
    userBadge.classList.add('show');
    userBadge.querySelector('.user-name').textContent = currentUser.displayName || currentUser.email || '';
  } else {
    loginBtn.style.display = '';
    userBadge.classList.remove('show');
  }
}

async function loadFromCloud(uid) {
  try {
    const snap = await cloudDb.collection('maps').doc(uid).get();
    if (snap.exists) {
      const data = snap.data();
      if (data && Array.isArray(data.nodes) && Array.isArray(data.edges)) {
        state = data;
      }
    }
  } catch (err) {
    console.error('クラウドデータの読み込みに失敗しました', err);
  }
  renderAll();
}

// ---------- ノード描画・操作 ----------
function renderAll() {
  renderNodes();
  renderEdges();
  scheduleSave();
}

function renderNodes() {
  const layer = document.getElementById('node-layer');
  layer.innerHTML = '';
  state.nodes.forEach(node => {
    const el = document.createElement('div');
    el.className = 'node-card';
    el.id = 'node-' + node.id;
    el.style.left = node.x + 'px';
    el.style.top = node.y + 'px';
    const children = node.children || [];
    const sublistHtml = children.length ? `
      <div class="inline-sublist">
        <div class="inline-sublist-title">小リスト</div>
        <ul>
          ${children.map(c => `<li data-id="${c.id}">${escapeHtml(c.label)}${c.children && c.children.length ? ' ›' : ''}</li>`).join('')}
        </ul>
      </div>
    ` : '';
    el.innerHTML = `
      <div class="node-icons">
        <div class="icon-btn edit-btn" title="名前を変更">✎</div>
        <div class="icon-btn del-btn" title="削除">×</div>
      </div>
      <div class="label">${escapeHtml(node.label)}</div>
      ${sublistHtml}
      <div class="connect-handle" title="ドラッグして線を接続"></div>
    `;
    layer.appendChild(el);
    attachNodeHandlers(el, node);
  });
}

function attachNodeHandlers(el, node) {
  el.querySelector('.edit-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    enterRenameMode(el, node);
  });
  el.querySelector('.del-btn').addEventListener('click', (e) => {
    e.stopPropagation();
    deleteNode(node.id);
  });
  el.querySelector('.connect-handle').addEventListener('pointerdown', (e) => {
    e.stopPropagation();
    startConnecting(node.id, e);
  });
  el.querySelectorAll('.inline-sublist li').forEach(li => {
    li.addEventListener('pointerdown', (e) => e.stopPropagation());
    li.addEventListener('click', (e) => {
      e.stopPropagation();
      openDetail(node.id);
      detailStack.push(li.dataset.id);
      renderDetail();
    });
  });
  el.addEventListener('pointerdown', (e) => {
    if (e.target.closest('.icon-btn') || e.target.closest('.connect-handle') || e.target.closest('.inline-sublist')) return;
    if (e.target.isContentEditable) return;
    startDragOrClick(el, node, e);
  });
}

function startDragOrClick(el, node, e) {
  e.preventDefault();
  const startX = e.clientX, startY = e.clientY;
  const origX = node.x, origY = node.y;
  let moved = false;
  el.classList.add('dragging');

  function onMove(ev) {
    const dx = ev.clientX - startX;
    const dy = ev.clientY - startY;
    if (Math.abs(dx) > 4 || Math.abs(dy) > 4) moved = true;
    node.x = origX + dx;
    node.y = origY + dy;
    el.style.left = node.x + 'px';
    el.style.top = node.y + 'px';
    renderEdges();
  }
  function onUp() {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    el.classList.remove('dragging');
    if (moved) {
      scheduleSave();
    } else {
      openDetail(node.id);
    }
  }
  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
}

function enterRenameMode(el, node) {
  const labelEl = el.querySelector('.label');
  labelEl.contentEditable = 'true';
  labelEl.focus();
  const range = document.createRange();
  range.selectNodeContents(labelEl);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  function finish() {
    labelEl.contentEditable = 'false';
    labelEl.removeEventListener('blur', finish);
    labelEl.removeEventListener('keydown', onKey);
    const newLabel = labelEl.textContent.trim() || '無題';
    node.label = newLabel;
    renderNodes();
    renderEdges();
    scheduleSave();
  }
  function onKey(e) {
    if (e.key === 'Enter') { e.preventDefault(); labelEl.blur(); }
    if (e.key === 'Escape') { e.preventDefault(); labelEl.textContent = node.label; labelEl.blur(); }
  }
  labelEl.addEventListener('blur', finish);
  labelEl.addEventListener('keydown', onKey);
}

function deleteNode(id) {
  state.nodes = state.nodes.filter(n => n.id !== id);
  state.edges = state.edges.filter(e => e.from !== id && e.to !== id);
  if (detailStack.length && detailStack[0] === id) closeDetail();
  renderAll();
}

// ---------- エッジ描画・操作 ----------
function edgeExists(from, to) {
  return state.edges.some(e => e.from === from && e.to === to);
}

function deleteEdge(id) {
  state.edges = state.edges.filter(e => e.id !== id);
  renderEdges();
  scheduleSave();
}

function edgePointOnBox(rect, canvasRect, towardX, towardY) {
  const cx = rect.left + rect.width / 2 - canvasRect.left;
  const cy = rect.top + rect.height / 2 - canvasRect.top;
  const hw = rect.width / 2 + 4, hh = rect.height / 2 + 4;
  const dx = towardX - cx, dy = towardY - cy;
  if (dx === 0 && dy === 0) return { x: cx, y: cy };
  const scaleX = dx !== 0 ? hw / Math.abs(dx) : Infinity;
  const scaleY = dy !== 0 ? hh / Math.abs(dy) : Infinity;
  const scale = Math.min(scaleX, scaleY);
  return { x: cx + dx * scale, y: cy + dy * scale };
}

let activeEdgeId = null;

function renderEdges() {
  const svg = document.getElementById('edge-layer');
  const canvasRect = document.getElementById('canvas').getBoundingClientRect();
  let html = `<defs><marker id="arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="8" markerHeight="8" orient="auto-start-reverse"><path d="M0,0 L10,5 L0,10 z" fill="#222222"/></marker></defs>`;

  state.edges.forEach(edge => {
    const fromEl = document.getElementById('node-' + edge.from);
    const toEl = document.getElementById('node-' + edge.to);
    if (!fromEl || !toEl) return;
    const fr = fromEl.getBoundingClientRect(), tr = toEl.getBoundingClientRect();
    const fcx = fr.left + fr.width / 2 - canvasRect.left, fcy = fr.top + fr.height / 2 - canvasRect.top;
    const tcx = tr.left + tr.width / 2 - canvasRect.left, tcy = tr.top + tr.height / 2 - canvasRect.top;
    const p1 = edgePointOnBox(fr, canvasRect, tcx, tcy);
    const p2 = edgePointOnBox(tr, canvasRect, fcx, fcy);
    const midx = (p1.x + p2.x) / 2, midy = (p1.y + p2.y) / 2;
    const tapped = edge.id === activeEdgeId ? ' tapped' : '';

    html += `
      <g class="edge-group${tapped}" data-edge-id="${edge.id}">
        <path class="edge-line" d="M${p1.x},${p1.y} L${p2.x},${p2.y}" stroke="#222222" stroke-width="2.6" fill="none" marker-end="url(#arrow)"/>
        <path class="edge-hit" d="M${p1.x},${p1.y} L${p2.x},${p2.y}" stroke="transparent" stroke-width="22" fill="none"/>
        <g class="edge-del" transform="translate(${midx},${midy})">
          <circle r="14"/>
          <text x="0" y="5" text-anchor="middle" font-size="16" font-weight="700">×</text>
        </g>
      </g>`;
  });

  svg.innerHTML = html;
  svg.querySelectorAll('.edge-hit').forEach(p => {
    p.addEventListener('click', (e) => {
      e.stopPropagation();
      activeEdgeId = p.closest('.edge-group').dataset.edgeId;
      renderEdges();
    });
  });
  svg.querySelectorAll('.edge-del').forEach(g => {
    g.addEventListener('click', (e) => {
      e.stopPropagation();
      activeEdgeId = null;
      deleteEdge(g.closest('.edge-group').dataset.edgeId);
    });
    g.addEventListener('pointerdown', (e) => e.stopPropagation());
  });
}

let connectingFrom = null;
let tempLineEl = null;

function startConnecting(nodeId, e) {
  connectingFrom = nodeId;
  document.getElementById('node-' + nodeId).classList.add('connecting-source');
  const svg = document.getElementById('edge-layer');
  tempLineEl = document.createElementNS('http://www.w3.org/2000/svg', 'line');
  tempLineEl.setAttribute('stroke', '#e4572e');
  tempLineEl.setAttribute('stroke-width', '2.5');
  tempLineEl.setAttribute('stroke-dasharray', '6,4');
  svg.appendChild(tempLineEl);

  function toCanvasPoint(ev) {
    const canvasRect = document.getElementById('canvas').getBoundingClientRect();
    return { x: ev.clientX - canvasRect.left, y: ev.clientY - canvasRect.top };
  }

  function onMove(ev) {
    const fromEl = document.getElementById('node-' + connectingFrom);
    const fromRect = fromEl.getBoundingClientRect();
    const canvasRect = document.getElementById('canvas').getBoundingClientRect();
    const fcx = fromRect.left + fromRect.width / 2 - canvasRect.left;
    const fcy = fromRect.top + fromRect.height / 2 - canvasRect.top;
    const p = toCanvasPoint(ev);
    tempLineEl.setAttribute('x1', fcx);
    tempLineEl.setAttribute('y1', fcy);
    tempLineEl.setAttribute('x2', p.x);
    tempLineEl.setAttribute('y2', p.y);
  }

  function onUp(ev) {
    document.removeEventListener('pointermove', onMove);
    document.removeEventListener('pointerup', onUp);
    const srcEl = document.getElementById('node-' + connectingFrom);
    if (srcEl) srcEl.classList.remove('connecting-source');
    if (tempLineEl) { tempLineEl.remove(); tempLineEl = null; }

    const targetEl = document.elementFromPoint(ev.clientX, ev.clientY);
    const cardEl = targetEl && targetEl.closest ? targetEl.closest('.node-card') : null;
    if (cardEl) {
      const targetId = cardEl.id.replace(/^node-/, '');
      if (targetId !== connectingFrom && !edgeExists(connectingFrom, targetId)) {
        state.edges.push({ id: uid('edge'), from: connectingFrom, to: targetId });
        scheduleSave();
      }
    }
    connectingFrom = null;
    renderEdges();
  }

  document.addEventListener('pointermove', onMove);
  document.addEventListener('pointerup', onUp);
}

// ---------- 詳細パネル（小リスト） ----------
let detailStack = [];

function openDetail(nodeId) {
  detailStack = [nodeId];
  document.getElementById('detail-overlay').classList.add('open');
  renderDetail();
}

function closeDetail() {
  document.getElementById('detail-overlay').classList.remove('open');
  detailStack = [];
}

function getCurrentItem() {
  let current = state.nodes.find(n => n.id === detailStack[0]);
  for (let i = 1; i < detailStack.length; i++) {
    if (!current) return null;
    if (!current.children) current.children = [];
    current = current.children.find(c => c.id === detailStack[i]);
  }
  return current;
}

function renderDetail() {
  const current = getCurrentItem();
  if (!current) { closeDetail(); return; }
  if (!current.children) current.children = [];

  // breadcrumb
  const path = [];
  let node = state.nodes.find(n => n.id === detailStack[0]);
  path.push(node);
  let cur = node;
  for (let i = 1; i < detailStack.length; i++) {
    cur = (cur.children || []).find(c => c.id === detailStack[i]);
    path.push(cur);
  }
  const crumbWrap = document.getElementById('detail-breadcrumb');
  crumbWrap.innerHTML = path.map((p, i) => {
    if (i === path.length - 1) {
      return `<div class="crumb current">${escapeHtml(p.label)}</div>`;
    }
    return `<span class="crumb" data-idx="${i}">${escapeHtml(p.label)}</span><span class="sep">›</span>`;
  }).join('');
  crumbWrap.querySelectorAll('.crumb[data-idx]').forEach(el => {
    el.addEventListener('click', () => {
      detailStack = detailStack.slice(0, parseInt(el.dataset.idx, 10) + 1);
      renderDetail();
    });
  });

  // list
  const listEl = document.getElementById('detail-list');
  if (current.children.length === 0) {
    listEl.innerHTML = `<li class="empty-msg">まだ項目がありません。下から追加できます。</li>`;
  } else {
    listEl.innerHTML = current.children.map(child => `
      <li data-id="${child.id}">
        <span class="item-label">${escapeHtml(child.label)}</span>
        ${child.children && child.children.length ? `<span class="item-count">(${child.children.length})</span>` : ''}
        <span class="icon-btn edit-btn" title="名前を変更">✎</span>
        <span class="icon-btn del-btn" title="削除">×</span>
        <span class="chevron">›</span>
      </li>
    `).join('');
    listEl.querySelectorAll('li').forEach(li => {
      const id = li.dataset.id;
      const labelEl = li.querySelector('.item-label');
      const openChild = () => {
        if (labelEl.isContentEditable) return;
        detailStack.push(id);
        renderDetail();
      };
      labelEl.addEventListener('click', openChild);
      li.querySelector('.chevron').addEventListener('click', openChild);
      li.querySelector('.edit-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        enterDetailRenameMode(labelEl, current.children.find(c => c.id === id));
      });
      li.querySelector('.del-btn').addEventListener('click', (e) => {
        e.stopPropagation();
        current.children = current.children.filter(c => c.id !== id);
        renderDetail();
        scheduleSave();
      });
    });
  }
}

function enterDetailRenameMode(labelEl, item) {
  labelEl.contentEditable = 'true';
  labelEl.focus();
  const range = document.createRange();
  range.selectNodeContents(labelEl);
  const sel = window.getSelection();
  sel.removeAllRanges();
  sel.addRange(range);

  function finish() {
    labelEl.removeEventListener('blur', finish);
    labelEl.removeEventListener('keydown', onKey);
    const newLabel = labelEl.textContent.trim() || '無題';
    item.label = newLabel;
    renderDetail();
    scheduleSave();
  }
  function onKey(e) {
    if (e.key === 'Enter') { e.preventDefault(); labelEl.blur(); }
    if (e.key === 'Escape') { e.preventDefault(); renderDetail(); }
  }
  labelEl.addEventListener('blur', finish);
  labelEl.addEventListener('keydown', onKey);
}

function addDetailItem() {
  const input = document.getElementById('detail-add-input');
  const label = input.value.trim();
  if (!label) return;
  const current = getCurrentItem();
  if (!current.children) current.children = [];
  current.children.push({ id: uid('item'), label, children: [] });
  input.value = '';
  renderDetail();
  scheduleSave();
}

// ---------- 初期化 ----------
function init() {
  renderAll();
  initAuth();

  document.getElementById('btn-add-node').addEventListener('click', () => {
    const wrap = document.getElementById('canvas-wrap');
    const x = wrap.scrollLeft + 160 + Math.random() * 60;
    const y = wrap.scrollTop + 160 + Math.random() * 60;
    state.nodes.push({ id: uid('node'), label: '新しいノード', x, y, children: [] });
    renderAll();
  });

  document.getElementById('detail-close').addEventListener('click', closeDetail);
  document.getElementById('detail-overlay').addEventListener('click', (e) => {
    if (e.target.id === 'detail-overlay') closeDetail();
  });
  document.getElementById('detail-add-btn').addEventListener('click', addDetailItem);
  document.getElementById('detail-add-input').addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addDetailItem();
  });

  document.getElementById('canvas').addEventListener('pointerdown', (e) => {
    if (e.target.id === 'canvas' && activeEdgeId) {
      activeEdgeId = null;
      renderEdges();
    }
  });

  document.addEventListener('keydown', (e) => {
    const ae = document.activeElement;
    const typing = ae && (ae.tagName === 'INPUT' || ae.tagName === 'TEXTAREA' || ae.isContentEditable);
    if (typing) return;
    if (e.key === 'Escape' && detailStack.length) {
      closeDetail();
    }
  });
}

init();
