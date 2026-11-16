// The DOM HUD: crosshair, hit marker, health, ammo, money, round timer, score,
// kill feed, the buy menu and the overlay screens. It never touches the
// simulation; main.js pushes numbers in and reads callbacks out. Every setter
// caches its last value so the DOM is only touched when something changes.
const BUY_ROWS = [
  { key: '1', id: 'sidearm', label: 'P9 Sidearm', price: 0 },
  { key: '2', id: 'smg', label: 'Rook-9 SMG', price: 950 },
  { key: '3', id: 'rifle', label: 'VK-47 Rifle', price: 2700 },
  { key: '4', id: 'dmr', label: 'Longshot DMR', price: 3100 },
  { key: '5', id: 'frag', label: 'Frag Grenade', price: 300, grenade: true },
  { key: '6', id: 'flash', label: 'Flash Grenade', price: 200, grenade: true },
  { key: '7', id: 'armor', label: 'Kevlar Vest (+50 armour)', price: 650, armor: true },
];

const OVERLAY_COPY = {
  start: {
    title: 'EMBERLINE',
    copy: 'A round-based tactical shooter in the Foundry Yard. You are Ember: push a site, plant the Spark, and hold it — or clear every Warden first.',
    action: 'Click to play',
  },
  paused: {
    title: 'EMBERLINE',
    copy: 'Paused. Click to resume.',
    action: 'Click to resume',
  },
};

export function createHud() {
  const $ = (id) => document.getElementById(id);
  const overlay = $('overlay');
  const title = $('overlay-title');
  const copy = $('overlay-copy');
  const play = $('play');
  const ammoEl = $('ammo');
  const ammoMag = $('ammo-mag');
  const ammoReserve = $('ammo-reserve');
  const weaponName = $('weapon-name');
  const healthFill = $('health-fill');
  const healthNum = $('health-num');
  const armorNum = $('armor-num');
  const moneyEl = $('money');
  const timerEl = $('timer');
  const roundEl = $('round-label');
  const scoreEmber = $('score-ember');
  const scoreWarden = $('score-warden');
  const aliveEmber = $('alive-ember');
  const aliveWarden = $('alive-warden');
  const killfeed = $('killfeed');
  const banner = $('banner');
  const bannerTitle = $('banner-title');
  const bannerSub = $('banner-sub');
  const promptEl = $('prompt');
  const progressEl = $('progress');
  const progressFill = $('progress-fill');
  const progressLabel = $('progress-label');
  const flashEl = $('flash');
  const damageEl = $('damage');
  const crosshair = $('crosshair');
  const hitmarker = $('hitmarker');
  const buyMenu = $('buy-menu');
  const buyTitle = $('buy-title');
  const buyRows = $('buy-rows');
  const buyMoney = $('buy-money');
  const spikeEl = $('spike');
  const spikeText = $('spike-text');

  let lastMag = -1;
  let lastReserve = -1;
  let lastWeapon = '';
  let lastHp = -1;
  let lastArmor = -1;
  let lastMoney = -1;
  let lastTimer = '';
  let lastScore = '';
  let lastAlive = '';
  let lastSpike = '';
  let hitTimer = 0;
  let bannerTimer = 0;
  let flashTimer = 0;
  let damageTimer = 0;
  let buyBase = '';
  let buyHandler = null;

  const rows = {};
  for (const row of BUY_ROWS) {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'buy-row';
    button.innerHTML = `<span class="buy-key">${row.key}</span><span class="buy-name">${row.label}</span><span class="buy-price">${row.price === 0 ? 'OWNED' : '$' + row.price}</span>`;
    button.addEventListener('click', () => {
      if (buyHandler) buyHandler(row);
    });
    buyRows.appendChild(button);
    rows[row.id] = button;
  }

  function setText(el, value, cache) {
    if (cache.value === value) return;
    cache.value = value;
    el.textContent = value;
  }

  return {
    setAmmo(mag, reserve, name) {
      if (mag !== lastMag || reserve !== lastReserve || name !== lastWeapon) {
        lastMag = mag;
        lastReserve = reserve;
        lastWeapon = name;
        ammoMag.textContent = String(mag);
        ammoReserve.textContent = `/ ${reserve}`;
        weaponName.textContent = name;
        ammoEl.classList.toggle('empty', mag === 0);
      }
    },
    setHealth(hp, armor) {
      if (hp !== lastHp || armor !== lastArmor) {
        lastHp = hp;
        lastArmor = armor;
        healthFill.style.width = `${Math.max(0, hp)}%`;
        healthFill.classList.toggle('low', hp <= 30);
        healthNum.textContent = String(Math.max(0, Math.ceil(hp)));
        armorNum.textContent = armor > 0 ? `+${Math.ceil(armor)} armour` : '';
      }
    },
    setMoney(money) {
      if (money !== lastMoney) {
        lastMoney = money;
        moneyEl.textContent = `$${money}`;
        buyMoney.textContent = `$${money}`;
      }
    },
    setTimer(seconds, phase) {
      const text = phase === 'buy' ? `BUY ${Math.ceil(seconds)}` : `${Math.floor(seconds / 60)}:${String(Math.floor(seconds % 60)).padStart(2, '0')}`;
      if (text !== lastTimer) {
        lastTimer = text;
        timerEl.textContent = text;
        timerEl.classList.toggle('urgent', phase === 'live' && seconds <= 10);
      }
    },
    setScore(scores, round) {
      const text = `${scores.ember}-${scores.warden}|${round}`;
      if (text !== lastScore) {
        lastScore = text;
        scoreEmber.textContent = String(scores.ember);
        scoreWarden.textContent = String(scores.warden);
        roundEl.textContent = `ROUND ${round}`;
      }
    },
    setAlive(ember, warden) {
      const text = `${ember}|${warden}`;
      if (text !== lastAlive) {
        lastAlive = text;
        aliveEmber.textContent = String(ember);
        aliveWarden.textContent = String(warden);
      }
    },
    setSpike(state, site, fuse) {
      const text = state === 'planted' ? `SPARK PLANTED — SITE ${site} — ${Math.ceil(fuse)}s` : state === 'carried' ? 'YOU CARRY THE SPARK' : '';
      if (text !== lastSpike) {
        lastSpike = text;
        spikeText.textContent = text;
        spikeEl.hidden = text === '';
        spikeEl.classList.toggle('planted', state === 'planted');
      }
    },
    setCrosshairSpread(px) {
      crosshair.style.setProperty('--gap', `${px.toFixed(1)}px`);
    },
    hitMarker(killed, holdMs = 90) {
      hitmarker.classList.add('on');
      hitmarker.style.transform = killed ? 'translate(-50%, -50%) rotate(45deg) scale(1.3)' : '';
      clearTimeout(hitTimer);
      hitTimer = setTimeout(() => {
        hitmarker.classList.remove('on');
        hitmarker.style.transform = '';
      }, holdMs);
    },
    addKill(text, good) {
      const line = document.createElement('div');
      line.className = good ? 'kill good' : 'kill bad';
      line.textContent = text;
      killfeed.prepend(line);
      while (killfeed.children.length > 5) killfeed.removeChild(killfeed.lastChild);
      setTimeout(() => line.remove(), 6000);
    },
    showBanner(titleText, subText, holdMs = 2600) {
      bannerTitle.textContent = titleText;
      bannerSub.textContent = subText;
      banner.hidden = false;
      clearTimeout(bannerTimer);
      bannerTimer = setTimeout(() => {
        banner.hidden = true;
      }, holdMs);
    },
    setPrompt(text) {
      if (promptEl.textContent !== (text || '')) promptEl.textContent = text || '';
      promptEl.hidden = !text;
    },
    setProgress(frac, label) {
      if (frac === null) {
        progressEl.hidden = true;
        return;
      }
      progressEl.hidden = false;
      progressFill.style.width = `${Math.round(frac * 100)}%`;
      progressLabel.textContent = label;
    },
    flash(strength) {
      flashEl.style.opacity = String(Math.min(1, strength));
      clearTimeout(flashTimer);
      flashTimer = setTimeout(() => {
        flashEl.style.opacity = '0';
      }, 120);
      flashEl.style.transition = 'opacity 1.4s linear';
      setTimeout(() => {
        flashEl.style.transition = 'opacity 0.1s linear';
      }, 130);
    },
    damageFlash() {
      damageEl.classList.add('on');
      clearTimeout(damageTimer);
      damageTimer = setTimeout(() => damageEl.classList.remove('on'), 220);
    },
    showBuyPhase(round, seconds) {
      buyBase = `BUY PHASE — ROUND ${round}`;
      buyTitle.textContent = buyBase;
      buyMenu.hidden = false;
    },
    updateBuyTimer(seconds) {
      buyTitle.textContent = `${buyBase} — ${Math.ceil(seconds)}s left`;
    },
    hideBuy() {
      buyMenu.hidden = true;
    },
    renderBuy(player) {
      for (const row of BUY_ROWS) {
        const button = rows[row.id];
        const afford = player.money >= row.price;
        const owned = row.id === player.weapon.def.id;
        button.classList.toggle('cannot', !afford && !owned);
        button.classList.toggle('owned', !!owned);
      }
    },
    onBuy(handler) {
      buyHandler = handler;
    },
    showRoundEnd(winner, reason, scores, round, holdMs = 4200) {
      const won = winner === 'ember';
      this.showBanner(
        won ? 'ROUND WON — EMBER' : 'ROUND LOST — WARDEN',
        `${reason} · Ember ${scores.ember} — ${scores.warden} Warden`,
        holdMs,
      );
    },
    showMatchEnd(winner, scores) {
      const won = winner === 'ember';
      title.textContent = won ? 'EMBERLINE — VICTORY' : 'EMBERLINE — DEFEAT';
      copy.textContent = won
        ? `The Foundry Yard is yours. Final score Ember ${scores.ember} — ${scores.warden} Warden.`
        : `The Wardens held the yard. Final score Ember ${scores.ember} — ${scores.warden} Warden.`;
      play.textContent = 'Play again';
      overlay.hidden = false;
    },
    showOverlay(mode) {
      const text = OVERLAY_COPY[mode];
      title.textContent = text.title;
      copy.textContent = text.copy;
      play.textContent = text.action;
      overlay.hidden = false;
      play.focus();
    },
    hideOverlay() {
      overlay.hidden = true;
    },
    onPlay(handler) {
      play.addEventListener('click', handler);
    },
  };
}
