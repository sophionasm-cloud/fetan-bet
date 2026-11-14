// Live bets feed. Rows are diffed by bet id and built with textContent only;
// names from the server are already masked and are never treated as HTML.
'use strict';
window.CrashFeed = (function () {
  const F = window.CrashFormat;
  const T = window.CrashI18n.t;
  const rows = new Map();
  const seen = new Set();
  let listEl = null;
  let emptyEl = null;
  let toggleEl = null;
  let countEl = null;
  let panelEl = null;
  let lastBets = [];

  function init() {
    listEl = document.getElementById('feed');
    emptyEl = document.getElementById('feedEmpty');
    toggleEl = document.getElementById('betsToggle');
    countEl = document.getElementById('betsToggleCount');
    panelEl = document.querySelector('.bets-panel');
    if (toggleEl) {
      toggleEl.addEventListener('click', () => {
        const expanded = toggleEl.getAttribute('aria-expanded') !== 'false';
        toggleEl.setAttribute('aria-expanded', expanded ? 'false' : 'true');
        panelEl?.classList.toggle('is-collapsed', expanded);
      });
    }
    window.CrashStore.subscribe((kind) => {
      if (['snapshot', 'phase', 'bet', 'cashout', 'crash'].includes(kind)) render();
    });
    render();
  }

  function rowFor(bet) {
    let row = rows.get(bet.id);
    if (row) return row;
    const el = document.createElement('div');
    el.className = 'bet-row';
    el.setAttribute('role', 'listitem');
    el.dataset.betId = String(bet.id);

    const name = document.createElement('span');
    name.className = 'bet-name';
    const mid = document.createElement('span');
    mid.className = 'bet-mid';
    const amount = document.createElement('span');
    amount.className = 'bet-amount';
    const amountValue = document.createElement('span');
    const cur = document.createElement('small');
    cur.textContent = 'ETB';

    el.append(name, mid, amount);
    amount.append(amountValue, cur);
    listEl?.appendChild(el);

    row = { el, name, mid, amount, amountValue };
    rows.set(bet.id, row);
    return row;
  }

  function updateRow(row, bet) {
    row.name.textContent = bet.mine ? 'You' : String(bet.label || 'Player');
    row.el.classList.toggle('is-mine', Boolean(bet.mine));
    row.el.classList.toggle('is-cashed', bet.status === 'cashed');
    row.el.classList.toggle('is-lost', bet.status === 'lost');
    row.el.classList.toggle('is-open', bet.status === 'open');

    if (bet.status === 'cashed') {
      row.mid.textContent = F.formatMultiplier(bet.cashoutHundredths);
      row.mid.title = T('table_cashout');
      row.amountValue.textContent = F.santimToEtb(bet.payout);
    } else if (bet.status === 'lost') {
      row.mid.textContent = '—';
      row.amountValue.textContent = F.santimToEtb(bet.stake);
    } else {
      row.mid.textContent = bet.autoCashout ? F.formatMultiplier(bet.autoCashout) : '—';
      row.mid.title = bet.autoCashout ? T('auto_cashout') : '';
      row.amountValue.textContent = F.santimToEtb(bet.stake);
    }

    const label = bet.status === 'cashed'
      ? `${row.name.textContent} ${F.formatMultiplier(bet.cashoutHundredths)} ${F.formatMoney(bet.payout)}`
      : `${row.name.textContent} ${F.formatMoney(bet.stake)}`;
    row.el.setAttribute('aria-label', label);
  }

  function render() {
    if (!listEl) return;
    const state = window.CrashStore.state;
    const bets = Array.isArray(state.bets) ? state.bets : [];
    lastBets = bets;

    const keep = new Set(bets.map((bet) => bet.id));
    for (const [id, row] of rows) {
      if (!keep.has(id)) {
        row.el.remove();
        rows.delete(id);
      }
    }

    let index = 0;
    for (const bet of bets) {
      const row = rowFor(bet);
      updateRow(row, bet);
      if (!seen.has(bet.id)) {
        seen.add(bet.id);
        row.el.classList.add('is-new');
        setTimeout(() => row.el.classList.remove('is-new'), 220);
      }
      // Keep DOM order aligned with server order without rebuilding nodes.
      if (listEl.children[index] !== row.el) {
        listEl.insertBefore(row.el, listEl.children[index] || null);
      }
      index += 1;
    }

    const empty = bets.length === 0;
    if (emptyEl) emptyEl.hidden = !empty;
    if (countEl) countEl.textContent = String(bets.length);
    if (toggleEl) {
      toggleEl.setAttribute('aria-label', `${T('live_bets')} (${bets.length})`);
    }
    if (state.phase === 'crashed' && empty) {
      if (emptyEl) emptyEl.querySelector('span').textContent = T('no_history');
    } else if (emptyEl) {
      emptyEl.querySelector('span').textContent = T('no_bets_yet');
    }
  }

  return {
    init,
    render,
    count: () => lastBets.length
  };
})();
