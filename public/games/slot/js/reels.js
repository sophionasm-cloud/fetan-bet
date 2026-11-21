'use strict';

(() => {
  const config = window.SLOT_CONFIG;
  const symbols = new Map(config.SYMBOLS.map((symbol) => [symbol.id, symbol]));
  const bellSvg = '<svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="M12 33h24l-3.4-4.7V20a8.6 8.6 0 0 0-17.2 0v8.3L12 33Z" fill="currentColor"/><path d="M20 36a4 4 0 0 0 8 0" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>';
  const wait = (duration) => new Promise((resolve) => setTimeout(resolve, duration));

  function cell(symbolId) {
    const element = document.createElement('span');
    const symbol = symbols.get(symbolId);
    element.className = `slot-cell slot-symbol-${symbolId}`;
    element.dataset.symbol = symbolId;
    element.setAttribute('aria-hidden', 'true');
    if (symbol) {
      const img = document.createElement('img');
      img.src = `./assets/${symbolId}.svg`;
      img.alt = '';
      img.className = 'slot-symbol-art';
      element.append(img);
    }
    return element;
  }

  async function animate(result, { turbo = false } = {}) {
    if (!result || !Array.isArray(result.stops) || result.stops.length !== config.REEL_COUNT ||
        result.stops.some((stop) => !Number.isInteger(stop) || stop < 0 || stop >= config.REEL_STOP_COUNT)) {
      throw new Error('INVALID_SERVER_RESULT');
    }
    const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches;
    if (reduced) return;
    const reels = [...document.querySelectorAll('.slot-reel')];
    const height = reels[0]?.querySelector('.slot-cell')?.getBoundingClientRect().height || 80;
    const speed = turbo ? config.TURBO_DURATION_DIVISOR : 1;
    const baseMs = config.SPIN_BASE_MS / speed;
    const stepMs = config.SPIN_REEL_STEP_MS / speed;
    const accelMs = config.REEL_ACCEL_MS / speed;
    const bounceMs = config.REEL_BOUNCE_MS / speed;

    await Promise.all(reels.map((reel, reelIndex) => new Promise((resolve) => {
      const track = reel.querySelector('.slot-reel-track');
      const strip = config.REELS[reelIndex].strip;
      const stop = result.stops[reelIndex];
      const targetIndex = config.REEL_SPIN_CYCLES * config.REEL_STOP_COUNT + stop;
      const targetPx = targetIndex * height;
      const items = Array.from({ length: targetIndex + config.ROWS }, (_, index) => strip[index % strip.length]);
      track.replaceChildren(...items.map(cell));
      track.setAttribute('aria-hidden', 'true');
      track.style.transition = 'none';
      track.style.transform = 'translate3d(0, 0, 0)';
      reel.classList.add('is-spinning');

      setTimeout(() => {
        const accelPx = Math.min(height * 8, targetPx - height);
        const acceleration = track.animate([
          { transform: 'translate3d(0, 0, 0)' },
          { transform: `translate3d(0, ${-accelPx}px, 0)` },
        ], { duration: accelMs, easing: 'cubic-bezier(.35,0,.75,.22)' });
        acceleration.onfinish = () => {
          track.style.transform = `translate3d(0, ${-accelPx}px, 0)`;
          acceleration.cancel();
          track.style.transition = `transform ${Math.max(1, baseMs - accelMs - bounceMs)}ms cubic-bezier(.08,.78,.13,1)`;
          requestAnimationFrame(() => {
            track.style.transform = `translate3d(0, ${-(targetPx + config.REEL_OVERSHOOT_PX)}px, 0)`;
            setTimeout(() => {
              track.style.transition = `transform ${bounceMs}ms cubic-bezier(.34,1.45,.64,1)`;
              track.style.transform = `translate3d(0, ${-targetPx}px, 0)`;
              setTimeout(() => {
                reel.classList.remove('is-spinning');
                resolve();
              }, bounceMs);
            }, Math.max(1, baseMs - accelMs - bounceMs));
          });
        };
      }, reelIndex * stepMs);
    })));
  }

  window.SLOT_REELS = Object.freeze({ animate });
})();
