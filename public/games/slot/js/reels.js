'use strict';

(() => {
  const config = window.SLOT_CONFIG;
  const symbols = new Map(config.SYMBOLS.map((symbol) => [symbol.id, symbol]));
  const bellSvg = '<svg viewBox="0 0 48 48" fill="none" aria-hidden="true"><path d="M12 33h24l-3.4-4.7V20a8.6 8.6 0 0 0-17.2 0v8.3L12 33Z" fill="currentColor"/><path d="M20 36a4 4 0 0 0 8 0" stroke="currentColor" stroke-width="3" stroke-linecap="round"/></svg>';
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
      img.onerror = () => { img.remove(); element.textContent = symbol.glyph || ''; };
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
    const targetGrid = window.SLOT_MATH.gridFromStops(result.stops);
    const accelerationMs = config.REEL_ACCEL_MS / speed;
    const decelerationMs = config.REEL_DECEL_MS / speed;
    const bounceMs = config.REEL_BOUNCE_MS / speed;

    await Promise.all(reels.map(async (reel, reelIndex) => {
      const track = reel.querySelector('.slot-reel-track');
      const strip = config.REELS[reelIndex].strip;
      const stop = result.stops[reelIndex];
      const targetIndex = config.SPIN_SYMBOL_STEPS + reelIndex * config.SPIN_REEL_STEP_SYMBOLS;
      const targetPx = targetIndex * height;
      const currentSymbols = Array.from(track.querySelectorAll('.slot-cell'))
        .slice(0, config.ROWS)
        .map((item) => item.dataset.symbol);
      const fallbackGrid = window.SLOT_MATH.gridFromStops([0, 0, 0, 0, 0]);
      const startSymbols = currentSymbols.length === config.ROWS && currentSymbols.every(Boolean)
        ? currentSymbols
        : fallbackGrid.map((row) => row[reelIndex]);
      const items = [...startSymbols];
      for (let index = config.ROWS; index < targetIndex; index += 1) {
        const sourceStop = (stop + index - targetIndex + config.REEL_STOP_COUNT) % config.REEL_STOP_COUNT;
        items.push(strip[sourceStop]);
      }
      items.push(...targetGrid.map((row) => row[reelIndex]));
      track.replaceChildren(...items.map(cell));
      track.setAttribute('aria-hidden', 'true');
      track.style.transition = 'none';
      track.style.transform = 'translate3d(0, 0, 0)';
      reel.classList.add('is-spinning');

      const duration = baseMs + reelIndex * stepMs;
      const cruiseMs = duration - accelerationMs - decelerationMs - bounceMs;
      const accelFraction = accelerationMs / duration;
      const decelStart = 1 - (decelerationMs + bounceMs) / duration;
      const bounceStart = 1 - bounceMs / duration;
      const overshootPx = config.REEL_OVERSHOOT_PX;
      const distancePx = targetPx + overshootPx;
      const velocity = distancePx / (duration - (accelerationMs + decelerationMs) / 2 - bounceMs);
      const accelerationPosition = velocity * accelerationMs / 2;
      const decelerationPosition = accelerationPosition + velocity * cruiseMs;
      const spin = track.animate([
        { transform: 'translate3d(0, 0, 0)', easing: 'cubic-bezier(.22,0,.5,1)' },
        { transform: `translate3d(0, ${-accelerationPosition}px, 0)`, offset: accelFraction, easing: 'linear' },
        { transform: `translate3d(0, ${-decelerationPosition}px, 0)`, offset: decelStart, easing: 'cubic-bezier(.25,.5,.68,1)' },
        { transform: `translate3d(0, ${-distancePx}px, 0)`, offset: bounceStart, easing: 'cubic-bezier(.34,1.25,.64,1)' },
        { transform: `translate3d(0, ${-targetPx}px, 0)` },
      ], { duration, easing: 'linear' });
      await spin.finished;
      track.style.transform = `translate3d(0, ${-targetPx}px, 0)`;
      spin.cancel();
      reel.classList.remove('is-spinning');
    }));
  }

  window.SLOT_REELS = Object.freeze({ animate });
})();
