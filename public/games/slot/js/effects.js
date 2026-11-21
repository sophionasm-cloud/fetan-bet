'use strict';

(() => {
  const config = window.SLOT_CONFIG;
  const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
  function countWin(element, from, to, format) {
    const duration = reducedMotion() ? 0 : config.WIN_COUNT_MS;
    if (!duration || from === to) { element.textContent = format(to); return Promise.resolve(); }
    return new Promise((resolve) => {
      const started = performance.now();
      const update = (now) => {
        const progress = Math.min(1, (now - started) / duration);
        element.textContent = format(Math.round(from + (to - from) * progress));
        if (progress < 1) requestAnimationFrame(update);
        else resolve();
      };
      requestAnimationFrame(update);
    });
  }
  function coinBurst(cabinet, count = config.COIN_BURST_COUNT) {
    if (reducedMotion()) return;
    const coins = Array.from({ length: count }, (_, index) => {
      const coin = document.createElement('span');
      coin.className = 'slot-coin';
      coin.setAttribute('aria-hidden', 'true');
      const angle = Math.PI * 2 * index / count;
      const distance = index % 2 ? 88 : 130;
      coin.style.setProperty('--coin-x', `${Math.cos(angle) * distance}px`);
      coin.style.setProperty('--coin-y', `${Math.sin(angle) * distance}px`);
      coin.style.animationDuration = `${config.COIN_BURST_MS}ms`;
      cabinet.append(coin);
      return coin;
    });
    setTimeout(() => coins.forEach((coin) => coin.remove()), config.COIN_BURST_MS + 40);
  }
  async function present({ result, bet, previousWin, winElement, cabinet, banner, format }) {
    cabinet.classList.remove('has-big-win', 'is-big-win', 'is-mega-win', 'show-win-banner');
    if (!result.totalPayout) {
      winElement.dataset.santim = '0';
      winElement.textContent = format(0);
      return;
    }

    // Stage 1: Highlight winning symbols/paylines and count up the actual payout
    await countWin(winElement, previousWin, result.totalPayout, format);
    winElement.dataset.santim = String(result.totalPayout);

    // Stage 2: Show celebratory pop-out banner with tier-based intensity
    const multiple = result.totalPayout / bet;
    const tier = multiple >= config.MEGA_WIN_MULTIPLE ? 'mega' : multiple >= config.BIG_WIN_MULTIPLE ? 'big' : 'win';
    cabinet.classList.add('has-big-win');
    if (tier !== 'win') cabinet.classList.add('is-big-win');
    if (tier === 'mega') cabinet.classList.add('is-mega-win');
    banner.textContent = tier === 'mega' ? 'MEGA WIN' : tier === 'big' ? 'BIG WIN' : 'WIN';
    banner.hidden = false;
    cabinet.classList.add('show-win-banner');

    if (tier === 'mega') {
      coinBurst(cabinet, config.COIN_BURST_COUNT * 2);
    } else if (tier === 'big') {
      coinBurst(cabinet, config.COIN_BURST_COUNT);
    } else {
      coinBurst(cabinet, Math.max(6, Math.floor(config.COIN_BURST_COUNT / 2)));
    }

    if (reducedMotion()) {
      cabinet.classList.remove('show-win-banner');
      banner.hidden = true;
      return;
    }

    await new Promise((resolve) => {
      setTimeout(() => {
        cabinet.classList.remove('show-win-banner');
        banner.hidden = true;
        resolve();
      }, config.WIN_BANNER_MS);
    });
  }
  window.SLOT_EFFECTS = Object.freeze({ present });
})();
