// History strip, round/my-bet tables, and the browser-side verifier. The
// verifier recomputes the commitment, HMAC and crash formula from revealed
// values; it never asks the server whether the result is valid.
'use strict';
window.CrashHistory = (function () {
  const C = window.CrashConfig;
  const F = window.CrashFormat;
  const T = window.CrashI18n.t;
  const encoder = new TextEncoder();

  let stripEl = null;
  let historyBtn = null;
  let dialog = null;
  let body = null;
  let tabs = [];
  let verifyDialog = null;
  let verifyBody = null;
  let activeTab = 'rounds';
  let roundRows = [];
  let betRows = [];
  let lastStripKey = '';

  const $ = (selector, root = document) => root.querySelector(selector);
  const $$ = (selector, root = document) => Array.from(root.querySelectorAll(selector));

  function el(tag, className, text) {
    const node = document.createElement(tag);
    if (className) node.className = className;
    if (text != null) node.textContent = String(text);
    return node;
  }

  function td(text, className) {
    return el('td', className || '', text);
  }

  function init() {
    stripEl = document.getElementById('historyStrip');
    historyBtn = document.getElementById('historyBtn');
    dialog = document.getElementById('historyDialog');
    body = document.getElementById('historyBody');
    verifyDialog = document.getElementById('verifyDialog');
    verifyBody = document.getElementById('verifyBody');
    tabs = $$('[data-history-tab]');

    historyBtn?.addEventListener('click', () => void open());
    for (const close of dialog ? $$('[data-dialog-close]', dialog) : []) {
      close.addEventListener('click', () => dialog.close());
    }
    for (const close of verifyDialog ? $$('[data-dialog-close]', verifyDialog) : []) {
      close.addEventListener('click', () => verifyDialog.close());
    }
    for (const tab of tabs) {
      tab.addEventListener('click', () => {
        activeTab = tab.dataset.historyTab === 'mine' ? 'mine' : 'rounds';
        syncTabs();
        render();
      });
    }
    window.CrashStore.subscribe((kind) => {
      if (['snapshot', 'crash', 'history'].includes(kind)) renderStrip();
    });
    renderStrip();
  }

  function syncTabs() {
    for (const tab of tabs) {
      tab.setAttribute('aria-selected', tab.dataset.historyTab === activeTab ? 'true' : 'false');
    }
  }

  async function open() {
    activeTab = 'rounds';
    syncTabs();
    if (typeof dialog?.showModal === 'function') dialog.showModal();
    body.replaceChildren(el('p', 'history-empty', T('no_history')));
    await loadRounds();
    render();
  }

  async function loadRounds() {
    try {
      const data = await window.CrashNet.fetchHistory();
      roundRows = Array.isArray(data.history) ? data.history : [];
    } catch (_) {
      roundRows = [];
    }
  }

  async function loadBets() {
    try {
      const data = await window.CrashNet.fetchMyBets();
      betRows = Array.isArray(data.bets) ? data.bets : [];
    } catch (_) {
      betRows = [];
    }
  }

  function table(headers, rows, emptyText) {
    if (!rows.length) return el('p', 'history-empty', emptyText);
    const wrap = el('table', 'history-table');
    const thead = document.createElement('thead');
    const headRow = document.createElement('tr');
    for (const [label, cls] of headers) headRow.appendChild(el('th', cls || '', label));
    thead.appendChild(headRow);
    const tbody = document.createElement('tbody');
    for (const cells of rows) {
      const row = document.createElement('tr');
      for (const cell of cells) {
        if (cell instanceof Node) row.appendChild(cell);
        else row.appendChild(td(cell == null ? '—' : cell));
      }
      tbody.appendChild(row);
    }
    wrap.append(thead, tbody);
    return wrap;
  }

  async function render() {
    if (!body) return;
    if (activeTab === 'mine') {
      body.replaceChildren(el('p', 'history-empty', T('no_my_bets')));
      await loadBets();
      const rows = betRows.map((bet) => {
        const result = bet.status === 'cashed'
          ? `${T('won')} +${F.santimToEtb(bet.payout)}`
          : bet.status === 'lost'
            ? T('lost')
            : T('table_none');
        return [
          F.formatTime(bet.createdAt),
          `#${bet.roundId}`,
          F.formatMoney(bet.stake),
          bet.autoCashout == null ? '—' : F.formatMultiplier(bet.autoCashout),
          bet.cashoutHundredths == null ? '—' : F.formatMultiplier(bet.cashoutHundredths),
          F.formatMoney(bet.payout || 0),
          result
        ];
      });
      body.replaceChildren(table([
        [T('table_time')], [T('table_round')], [T('table_stake')], [T('auto_cashout')],
        [T('table_cashout')], [T('table_payout')], [T('table_result')]
      ], rows, T('no_my_bets')));
      return;
    }

    if (!roundRows.length) {
      await loadRounds();
    }
    const rows = roundRows.map((round) => {
      const time = td(F.formatTime(round.crashedAt));
      const id = td(`#${round.roundId}`);
      const mult = td(
        F.formatMultiplier(round.crashHundredths),
        Number(round.crashHundredths) >= C.redPillThreshold ? 'num is-hot' : 'num'
      );
      const hash = td(F.shortHash(round.serverSeedHash, 8, 6), 'hash');
      hash.title = round.serverSeedHash;
      const action = document.createElement('td');
      action.className = 'num';
      const verify = el('button', 'verify-btn', T('verify_round'));
      verify.type = 'button';
      verify.addEventListener('click', () => void openVerify(round.roundId));
      action.appendChild(verify);
      return [time, id, mult, hash, action];
    });
    body.replaceChildren(table([
      [T('table_time')], [T('table_round')], [T('table_multiplier')],
      [T('table_hash')], ['']
    ], rows, T('no_history')));
  }

  function renderStrip() {
    if (!stripEl) return;
    const history = Array.isArray(window.CrashStore.state.history) ? window.CrashStore.state.history : [];
    const slice = history.slice(0, C.stripLength).reverse();
    const key = slice.map((round) => `${round.roundId}:${round.crashHundredths}`).join('|');
    if (key === lastStripKey) return;
    const newestId = slice.length ? slice[slice.length - 1].roundId : null;
    const previousNewest = lastStripKey ? Number(lastStripKey.split('|').pop().split(':')[0]) : null;
    lastStripKey = key;
    stripEl.replaceChildren();
    if (!slice.length) {
      const empty = el('span', 'sr-only', T('no_history'));
      empty.setAttribute('role', 'listitem');
      stripEl.appendChild(empty);
      stripEl.setAttribute('aria-label', T('no_history'));
      return;
    }
    for (const round of slice) {
      const pill = el('span', 'pill', F.formatMultiplier(round.crashHundredths));
      if (Number(round.crashHundredths) >= C.redPillThreshold) pill.classList.add('is-hot');
      pill.setAttribute('role', 'listitem');
      pill.title = `${T('table_round')} #${round.roundId} · ${F.formatTime(round.crashedAt)}`;
      if (Number(round.roundId) === Number(newestId) && Number(newestId) !== previousNewest) {
        pill.classList.add('is-new');
      }
      stripEl.appendChild(pill);
    }
    stripEl.setAttribute(
      'aria-label',
      slice.length ? `${T('table_multiplier')}: ${slice.map((round) => F.formatMultiplier(round.crashHundredths)).join(', ')}` : ''
    );
  }

  function field(list, label, value, className) {
    list.appendChild(el('dt', '', label));
    const dd = el('dd', className || '', value);
    list.appendChild(dd);
    return dd;
  }

  async function computeVerify(data) {
    if (!window.crypto?.subtle) throw new Error('NO_WEBCRYPTO');
    const seedBytes = encoder.encode(String(data.serverSeed));
    const digest = await window.crypto.subtle.digest('SHA-256', seedBytes);
    const hash = Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
    const key = await window.crypto.subtle.importKey(
      'raw',
      seedBytes,
      { name: 'HMAC', hash: 'SHA-256' },
      false,
      ['sign']
    );
    const signature = await window.crypto.subtle.sign(
      'HMAC',
      key,
      encoder.encode(`${data.clientSeed}:${data.nonce}`)
    );
    const hmac = Array.from(new Uint8Array(signature), (byte) => byte.toString(16).padStart(2, '0')).join('');
    const x = BigInt(`0x${hmac.slice(0, 13)}`);
    const base = 1n << 52n;
    const edge = BigInt(10000 - Number(data.edgeBp));
    const raw = (100n * edge * base) / (10000n * (base - x));
    const max = BigInt(Number(data.maxHundredths));
    const crash = raw < 100n ? 100 : raw > max ? Number(max) : Number(raw);
    return {
      hash,
      hashOk: hash === String(data.serverSeedHash).toLowerCase(),
      hmac,
      crash,
      crashOk: crash === Number(data.crashHundredths)
    };
  }

  async function openVerify(roundId) {
    if (!verifyDialog) return;
    if (typeof verifyDialog.showModal === 'function' && !verifyDialog.open) verifyDialog.showModal();
    verifyBody.replaceChildren(el('p', 'history-empty', T('verify_wait')));
    try {
      const data = await window.CrashNet.fetchVerify(roundId);
      const result = await computeVerify(data);
      const list = el('dl', 'verify-grid');
      field(list, T('server_seed'), data.serverSeed, 'hash');
      field(list, T('server_hash'), data.serverSeedHash, 'hash');
      field(list, T('client_seed'), data.clientSeed, 'hash');
      field(list, T('nonce'), String(data.nonce));
      const edgeBp = Number(data.edgeBp);
      const edgeText = `${Math.floor(edgeBp / 100)}.${String(edgeBp % 100).padStart(2, '0')}%`;
      field(list, T('edge'), edgeText);
      field(list, T('max_multiplier'), F.formatMultiplier(data.maxHundredths));
      field(list, T('crash_point'), F.formatMultiplier(result.crash));

      const status = el(
        'div',
        `verify-status ${result.hashOk && result.crashOk ? 'is-ok' : 'is-bad'}`,
        result.hashOk && result.crashOk ? T('verify_ok') : T('verify_bad')
      );
      const detail = el(
        'p',
        'auto-hint',
        `${T('formula')}: HMAC-SHA-256(server seed, client seed:nonce) → ${result.hmac.slice(0, 13)}… · ` +
        `${result.crashOk ? '✓' : '✗'} ${F.formatMultiplier(data.crashHundredths)} · ` +
        `${result.hashOk ? '✓' : '✗'} SHA-256`
      );
      verifyBody.replaceChildren(list, status, detail);
      window.CrashUI?.announce(result.hashOk && result.crashOk ? T('verify_ok') : T('verify_bad'));
    } catch (err) {
      verifyBody.replaceChildren(el('p', 'verify-status is-wait', T('verify_error')));
    }
  }

  async function openLatestVerify() {
    if (!roundRows.length) await loadRounds();
    const latest = roundRows[0] || window.CrashStore.state.history[0];
    if (!latest) {
      window.CrashUI?.toast(T('no_history'), 'error');
      return;
    }
    await openVerify(latest.roundId);
  }

  return {
    init,
    open,
    openVerify,
    openLatestVerify,
    renderStrip,
    render
  };
})();
