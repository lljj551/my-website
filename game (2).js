/* ============================================================================
   game.js —— B 模块：Canvas 2D 射击（5 组 / 悍匪与人质 / 圆形命中）
   ----------------------------------------------------------------------------
   规则：
     - 共 5 组，每组随机 2~4 个目标，悍匪与人质混合
     - 目标存活时间：2500 / 2000 / 1600 / 1300 / 1000 ms
     - 同一组目标同时出现；全部消失后进入下一组
     - 命中悍匪 +1；命中人质立即失败；超时悍匪计入漏网，不影响胜负
     - 5 组结束且未误伤人质 → 挑战成功，展示命中率与漏网数

   渲染：准星、枪口闪光、命中闪白、粒子全部绘制在 Canvas 上，无音频。
   ========================================================================== */

(function (global) {
  'use strict';

  var ZRD = global.ZRD;
  var cfg = ZRD.config.game;
  var util = ZRD.util;

  var dom = {};
  var ctx = null;
  var dpr = 1;
  var cssW = 0;
  var cssH = 0;

  var state = 'idle'; // idle | countdown | running | paused | over
  var pausedFrom = 'idle';
  var pausedAt = 0;

  var rafId = 0;
  var lastTs = 0;

  var roundIndex = 0;
  var targets = [];
  var particles = [];
  var stats = createStats();

  var countdownEndsAt = 0;
  var nextRoundAt = 0;
  var banner = null;

  var mouse = { x: 0, y: 0, inside: false };
  var flash = null;
  var floaters = [];
  var aimScale = 1;
  var aimTarget = 1;
  var shakeUntil = 0;
  var shakeX = 0;
  var shakeY = 0;

  var seq = 0;
  var resizeObserver = null;
  var scrollLocked = false;

  function createStats() {
    return {
      hits: 0,
      shots: 0,
      escaped: 0,
      hostageHits: 0,
      roundsCompleted: 0
    };
  }

  /* ---------------------------------------------------------------- 初始化 */

  function init(opts) {
    dom = opts || {};
    dom.canvas = dom.canvas || util.el('#game-canvas');
    dom.field = dom.field || util.el('#field');
    dom.idle = dom.idle || util.el('#field-idle');
    dom.countdown = dom.countdown || util.el('#field-countdown');
    dom.startBtn = dom.startBtn || util.el('#btn-start');

    dom.hud = {
      round: util.el('#hud-round'),
      score: util.el('#hud-score'),
      shots: util.el('#hud-shots'),
      acc: util.el('#hud-acc'),
      bar: util.el('#hud-bar-fill')
    };

    if (!dom.canvas) {
      console.warn('[ZRD] game.init 缺少 canvas');
      return;
    }

    ctx = dom.canvas.getContext('2d');
    bindEvents();
    resize();
    renderHud();
    clearCanvas();

    util.log('game.init ok');
  }

  function bindEvents() {
    util.on(dom.startBtn, 'click', start);

    util.on(dom.field, 'pointermove', function (e) {
      var p = toLocal(e);
      mouse.x = p.x;
      mouse.y = p.y;
      mouse.inside = true;
    });

    util.on(dom.field, 'pointerleave', function () {
      mouse.inside = false;
    });

    util.on(dom.field, 'pointerdown', function (e) {
      if (state !== 'running') return;
      if (e.pointerType === 'mouse' && e.button !== 0) return;

      var p = toLocal(e);
      mouse.x = p.x;
      mouse.y = p.y;
      mouse.inside = true;
      e.preventDefault();

      // 鼠标按下：准星瞬间向内收；松开后回弹
      aimTarget = 0.62;
      aimScale = Math.min(aimScale, 0.76);

      shoot(p.x, p.y, util.now());
    });

    util.on(dom.field, 'contextmenu', function (e) {
      e.preventDefault();
    });

    util.on(global, 'pointerup', function () {
      aimTarget = 1;
    });

    util.on(global, 'pointercancel', function () {
      aimTarget = 1;
    });

    util.on(global, 'blur', function () {
      aimTarget = 1;
    });

    util.on(global, 'resize', resize);

    if (global.ResizeObserver && dom.field) {
      resizeObserver = new global.ResizeObserver(function () {
        resize();
      });
      resizeObserver.observe(dom.field);
    }
  }

  function toLocal(e) {
    var rect = dom.canvas.getBoundingClientRect();
    return {
      x: util.clamp(e.clientX - rect.left, 0, cssW),
      y: util.clamp(e.clientY - rect.top, 0, cssH)
    };
  }

  /* ---------------------------------------------------------------- 尺寸 */

  function resize() {
    if (!dom.canvas) return;

    var rect = dom.canvas.getBoundingClientRect();
    cssW = Math.max(1, Math.round(rect.width));
    cssH = Math.max(1, Math.round(rect.height));
    dpr = Math.min(global.devicePixelRatio || 1, 2);

    dom.canvas.width = Math.round(cssW * dpr);
    dom.canvas.height = Math.round(cssH * dpr);

    if (ctx) ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    // 视口变化时把目标收回安全区
    for (var i = 0; i < targets.length; i++) {
      var t = targets[i];
      t.x = util.clamp(t.x, t.r + 10, Math.max(t.r + 10, cssW - t.r - 10));
      t.y = util.clamp(t.y, t.r + 10, Math.max(t.r + 10, cssH - t.r - 10));
    }

    if (state === 'idle') clearCanvas();
    else draw(util.now());
  }

  /* ---------------------------------------------------------------- 滚动锁定 */

  function lockPageScroll() {
    if (scrollLocked) return;
    scrollLocked = true;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';
  }

  function unlockPageScroll() {
    if (!scrollLocked) return;
    scrollLocked = false;
    document.body.style.overflow = '';
    document.documentElement.style.overflow = '';
  }

  /* ---------------------------------------------------------------- 生命周期 */

  function start() {
    if (state === 'countdown' || state === 'running' || state === 'paused') return;

    cancelLoop();
    resetRoundState();
    lockPageScroll();

    state = 'countdown';
    countdownEndsAt = util.now() + cfg.countdownMs;

    if (dom.idle) dom.idle.classList.add('is-hidden');
    if (dom.countdown) {
      dom.countdown.hidden = false;
      dom.countdown.textContent = '3';
    }
    if (dom.field) {
      dom.field.classList.add('is-running');
      dom.field.classList.remove('is-over');
    }

    renderHud();
    startLoop();
    ZRD.bus.emit('game:start', { rounds: cfg.rounds.length });
  }

  function startLoop() {
    if (rafId) cancelAnimationFrame(rafId);
    lastTs = util.now();
    rafId = global.requestAnimationFrame(loop);
  }

  function cancelLoop() {
    if (rafId) global.cancelAnimationFrame(rafId);
    rafId = 0;
  }

  function loop(ts) {
    rafId = global.requestAnimationFrame(loop);

    if (!ctx || state === 'paused' || state === 'over') {
      lastTs = ts;
      return;
    }

    var dt = Math.min((ts - lastTs) / 1000, 0.05);
    lastTs = ts;
    var now = util.now();

    if (state === 'countdown') {
      var remain = countdownEndsAt - now;
      var n = Math.ceil(remain / 800);
      setCountdown(n > 0 ? String(n) : 'GO');
      if (remain <= 0) startRound(0);
    } else if (state === 'running') {
      updateTargets(now);
      updateParticles(dt);
      updateFloaters(dt);
      maybeAdvanceRound(now);
    }

    var aimSpeed = aimTarget < aimScale ? 36 : 16;
    aimScale += (aimTarget - aimScale) * Math.min(1, dt * aimSpeed);

    draw(now);
  }

  function startRound(index) {
    roundIndex = index;
    state = 'running';
    nextRoundAt = 0;
    if (dom.countdown) dom.countdown.hidden = true;

    spawnRound(util.now());
    banner = { text: 'ROUND ' + (index + 1), until: util.now() + 700 };
    renderHud();
  }

  /* ---------------------------------------------------------------- 目标生成 */

  function targetRadius() {
    return Math.round(util.clamp(Math.min(cssW, cssH) * 0.062, 26, 42));
  }

  function spawnRound(now) {
    var count = util.randInt(cfg.minTargets, cfg.maxTargets);
    var gangsters = util.randInt(1, count - 1); // 至少 1 名悍匪 + 1 名人质
    var types = [];

    for (var g = 0; g < gangsters; g++) types.push('gangster');
    for (var h = gangsters; h < count; h++) types.push('hostage');
    shuffle(types);

    var lifetime = cfg.rounds[roundIndex] || cfg.rounds[cfg.rounds.length - 1];
    var r = targetRadius();

    targets = [];
    for (var i = 0; i < types.length; i++) {
      var spot = findSpot(r);
      targets.push({
        id: ++seq,
        type: types[i],
        x: spot.x,
        y: spot.y,
        r: r,
        seed: Math.random() * 1000,
        bornAt: now,
        expiresAt: now + lifetime,
        state: 'live',
        hitAt: 0,
        removeAt: 0
      });
    }
  }

  function findSpot(r) {
    var pad = r + 18;
    var maxX = Math.max(pad + 1, cssW - pad);
    var maxY = Math.max(pad + 1, cssH - pad);
    var best = { x: cssW / 2, y: cssH / 2 };

    for (var attempt = 0; attempt < 48; attempt++) {
      best = {
        x: util.rand(pad, maxX),
        y: util.rand(pad, maxY)
      };

      var ok = true;
      for (var i = 0; i < targets.length; i++) {
        var t = targets[i];
        var dx = best.x - t.x;
        var dy = best.y - t.y;
        if (Math.hypot(dx, dy) < r + t.r + 18) {
          ok = false;
          break;
        }
      }
      if (ok) return best;
    }

    return best;
  }

  function shuffle(list) {
    for (var i = list.length - 1; i > 0; i--) {
      var j = util.randInt(0, i);
      var tmp = list[i];
      list[i] = list[j];
      list[j] = tmp;
    }
  }

  /* ---------------------------------------------------------------- 更新 */

  function updateTargets(now) {
    for (var i = targets.length - 1; i >= 0; i--) {
      var t = targets[i];

      if (t.state === 'hit') {
        if (now >= t.removeAt) targets.splice(i, 1);
        continue;
      }

      if (now >= t.expiresAt) {
        if (t.type === 'gangster') stats.escaped += 1;
        targets.splice(i, 1);
      }
    }
  }

  function maybeAdvanceRound(now) {
    if (targets.length > 0) return;

    if (roundIndex >= cfg.rounds.length - 1) {
      finishGame('success');
      return;
    }

    if (!nextRoundAt) {
      nextRoundAt = now + cfg.roundGapMs;
      stats.roundsCompleted = Math.max(stats.roundsCompleted, roundIndex + 1);
      banner = { text: 'ROUND CLEAR', until: now + cfg.roundGapMs };
      renderHud();
      return;
    }

    if (now >= nextRoundAt) startRound(roundIndex + 1);
  }

  function updateParticles(dt) {
    for (var i = particles.length - 1; i >= 0; i--) {
      var p = particles[i];
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      p.vx *= 0.93;
      p.vy *= 0.93;
      if (p.spin) p.angle += p.spin * dt;
      p.life -= dt;
      if (p.life <= 0) particles.splice(i, 1);
    }
  }

  function updateFloaters(dt) {
    for (var i = floaters.length - 1; i >= 0; i--) {
      var f = floaters[i];
      f.life += dt;
      if (f.life >= f.maxLife) floaters.splice(i, 1);
    }
  }

  /* ---------------------------------------------------------------- 射击 */

  function shoot(x, y, now) {
    if (state !== 'running') return;

    stats.shots += 1;
    if (ZRD.audio && ZRD.audio.shot) ZRD.audio.shot();
    triggerShake(now);

    flash = {
      x: x,
      y: y,
      until: now + cfg.muzzleFlashMs,
      seed: Math.random() * 10
    };

    var hit = null;
    for (var i = targets.length - 1; i >= 0; i--) {
      var t = targets[i];
      if (t.state !== 'live' || now >= t.expiresAt) continue;
      var dx = x - t.x;
      var dy = y - t.y;
      if (dx * dx + dy * dy < t.r * t.r) {
        hit = t;
        break;
      }
    }

    if (hit) {
      hit.state = 'hit';
      hit.hitAt = now;
      hit.removeAt = now + cfg.hitFlashMs;

      if (hit.type === 'hostage') {
        stats.hostageHits += 1;
        if (ZRD.audio && ZRD.audio.fail) ZRD.audio.fail();
        renderHud();
        finishGame('fail');
        return;
      }

      stats.hits += 1;
      if (ZRD.audio && ZRD.audio.hit) ZRD.audio.hit();
      spawnHitParticles(hit.x, hit.y);
      spawnFloater(hit.x, hit.y);
      renderHud();
      ZRD.bus.emit('game:hit', { type: 'gangster', hits: stats.hits, shots: stats.shots });
      return;
    }

    renderHud();
    ZRD.bus.emit('game:miss', { x: x, y: y, shots: stats.shots });
  }

  function triggerShake(now) {
    shakeUntil = now + 50;
    var angle = Math.random() * Math.PI * 2;
    var amp = util.rand(2, 3);
    shakeX = Math.cos(angle) * amp;
    shakeY = Math.sin(angle) * amp;
  }

  function spawnFloater(x, y) {
    floaters.push({
      x: x,
      y: y - 4,
      life: 0,
      maxLife: 0.7
    });
  }

  function spawnHitParticles(x, y) {
    for (var i = 0; i < cfg.hitParticles; i++) {
      var angle = Math.random() * Math.PI * 2;
      var speed = util.rand(70, 260);
      var life = util.rand(0.18, 0.42);
      particles.push({
        kind: 'dot',
        x: x,
        y: y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        life: life,
        maxLife: life,
        size: util.rand(1.2, 2.8),
        color: Math.random() < 0.45 ? '255,255,255' : '255,150,90'
      });
    }

    // 少量带旋转的碎片，让爆炸更像“炸开”而不是一团点
    for (var j = 0; j < 10; j++) {
      var shardAngle = Math.random() * Math.PI * 2;
      var shardSpeed = util.rand(90, 300);
      var shardLife = util.rand(0.22, 0.5);
      particles.push({
        kind: 'shard',
        x: x,
        y: y,
        vx: Math.cos(shardAngle) * shardSpeed,
        vy: Math.sin(shardAngle) * shardSpeed - 35,
        angle: Math.random() * Math.PI * 2,
        spin: util.rand(-14, 14),
        life: shardLife,
        maxLife: shardLife,
        size: util.rand(3, 6.5),
        color: j % 3 === 0 ? '201,242,77' : '255,180,120'
      });
    }
  }

  /* ---------------------------------------------------------------- 结束 */

  function snapshot(outcome) {
    return {
      outcome: outcome,
      hits: stats.hits,
      shots: stats.shots,
      escaped: stats.escaped,
      hostageHits: stats.hostageHits,
      accuracy: stats.shots > 0 ? stats.hits / stats.shots : null,
      roundsCompleted: outcome === 'success' ? cfg.rounds.length : stats.roundsCompleted,
      round: outcome === 'success' ? cfg.rounds.length : Math.min(cfg.rounds.length, roundIndex + 1)
    };
  }

  function finishGame(outcome) {
    if (state === 'over') return;

    state = 'over';
    cancelLoop();
    unlockPageScroll();

    if (dom.countdown) dom.countdown.hidden = true;
    if (dom.field) {
      dom.field.classList.remove('is-running');
      dom.field.classList.add('is-over');
    }

    if (outcome === 'success') stats.roundsCompleted = cfg.rounds.length;
    banner = outcome === 'success' ? { text: 'MISSION CLEAR', until: util.now() + 900 } : null;

    renderHud();
    draw(util.now());

    ZRD.bus.emit('game:end', {
      outcome: outcome,
      stats: snapshot(outcome)
    });
  }

  function resetRoundState() {
    stats = createStats();
    targets = [];
    particles = [];
    floaters = [];
    roundIndex = 0;
    nextRoundAt = 0;
    countdownEndsAt = 0;
    banner = null;
    flash = null;
    aimScale = 1;
    aimTarget = 1;
    shakeUntil = 0;
    shakeX = 0;
    shakeY = 0;
  }

  function reset() {
    cancelLoop();
    state = 'idle';
    pausedFrom = 'idle';
    pausedAt = 0;
    resetRoundState();
    mouse.inside = false;
    unlockPageScroll();

    if (dom.idle) dom.idle.classList.remove('is-hidden');
    if (dom.countdown) dom.countdown.hidden = true;
    if (dom.field) dom.field.classList.remove('is-running', 'is-over');

    renderHud();
    clearCanvas();
  }

  /* ---------------------------------------------------------------- 暂停 */

  function stop() {
    if (state !== 'running' && state !== 'countdown') return;
    pausedFrom = state;
    pausedAt = util.now();
    state = 'paused';
    cancelLoop();
  }

  function resume() {
    if (state !== 'paused') return;

    var now = util.now();
    var delta = now - pausedAt;

    for (var i = 0; i < targets.length; i++) {
      var t = targets[i];
      if (t.expiresAt) t.expiresAt += delta;
      if (t.hitAt) t.hitAt += delta;
      if (t.removeAt) t.removeAt += delta;
    }
    if (countdownEndsAt) countdownEndsAt += delta;
    if (nextRoundAt) nextRoundAt += delta;
    if (flash) flash.until += delta;
    if (banner) banner.until += delta;
    if (shakeUntil) shakeUntil += delta;

    state = pausedFrom;
    pausedAt = 0;
    startLoop();
  }

  /* ---------------------------------------------------------------- HUD */

  function renderHud() {
    if (!dom.hud) return;

    var active = state !== 'idle';
    var roundNo = active ? util.clamp(roundIndex + 1, 1, cfg.rounds.length) : 0;

    if (dom.hud.round) {
      dom.hud.round.textContent = active
        ? util.pad(roundNo, 2) + ' / ' + util.pad(cfg.rounds.length, 2)
        : '— / ' + cfg.rounds.length;
    }
    if (dom.hud.score) dom.hud.score.textContent = util.pad(stats.hits, 2);
    if (dom.hud.shots) dom.hud.shots.textContent = util.pad(stats.shots, 2);

    if (dom.hud.acc) {
      dom.hud.acc.textContent =
        stats.shots > 0 ? Math.round((stats.hits / stats.shots) * 100) + '%' : '—';
    }

    if (dom.hud.bar) {
      var ratio = active ? roundNo / cfg.rounds.length : 0;
      dom.hud.bar.style.transform = 'scaleX(' + util.clamp(ratio, 0, 1) + ')';
    }
  }

  function setCountdown(text) {
    if (!dom.countdown || dom.countdown.textContent === text) return;
    dom.countdown.textContent = text;
  }

  /* ---------------------------------------------------------------- 绘制 */

  function clearCanvas() {
    if (ctx) ctx.clearRect(0, 0, cssW, cssH);
  }

  function draw(now) {
    if (!ctx) return;
    ctx.clearRect(0, 0, cssW, cssH);

    ctx.save();
    if (now < shakeUntil) ctx.translate(shakeX, shakeY);

    drawBanner(now);
    drawTargets(now);
    drawParticles();
    drawFloaters();
    drawMuzzle(now);
    drawCrosshair();

    ctx.restore();
  }

  function drawBanner(now) {
    if (!banner || now >= banner.until) return;

    var alpha = util.clamp((banner.until - now) / 320, 0, 1);
    ctx.save();
    ctx.globalAlpha = Math.min(1, alpha);
    ctx.textAlign = 'center';
    ctx.fillStyle = 'rgba(233, 238, 243, 0.55)';
    ctx.font = '600 20px "Chakra Petch", "Noto Sans SC", sans-serif';
    ctx.fillText(banner.text, cssW / 2, 46);
    ctx.restore();
  }

  function drawTargets(now) {
    for (var i = 0; i < targets.length; i++) {
      var t = targets[i];
      var appear = util.clamp((now - t.bornAt) / 150, 0, 1);
      var scale = util.easeOutCubic(appear);

      ctx.save();
      ctx.translate(t.x, t.y);
      ctx.scale(scale, scale);

      if (t.state === 'hit') {
        drawHitFlash(t, now);
      } else {
        if (t.type === 'gangster') drawGangster(t.r);
        else drawHostage(t.r);
        drawLifeRing(t, now);
      }

      ctx.restore();
    }
  }

  function drawGangster(r) {
    var g = ctx.createRadialGradient(-r * 0.3, -r * 0.35, r * 0.08, 0, 0, r * 1.05);
    g.addColorStop(0, '#a63822');
    g.addColorStop(0.55, '#671b0f');
    g.addColorStop(1, '#2a0804');

    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();

    ctx.lineWidth = 2;
    ctx.strokeStyle = '#ff6a3d';
    ctx.stroke();

    // 黑色眼罩横条
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, r - 1, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#06080b';
    ctx.fillRect(-r, -r * 0.26, r * 2, r * 0.3);
    ctx.restore();

    // 眼罩内的暗红眼缝
    ctx.fillStyle = 'rgba(255, 120, 70, 0.65)';
    ctx.fillRect(-r * 0.46, -r * 0.16, r * 0.24, r * 0.05);
    ctx.fillRect(r * 0.22, -r * 0.16, r * 0.24, r * 0.05);

    // 下颌阴影
    ctx.beginPath();
    ctx.arc(0, r * 0.38, r * 0.5, 0.15 * Math.PI, 0.85 * Math.PI);
    ctx.strokeStyle = 'rgba(0, 0, 0, 0.45)';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  function drawHostage(r) {
    var g = ctx.createRadialGradient(-r * 0.32, -r * 0.36, r * 0.08, 0, 0, r * 1.04);
    g.addColorStop(0, '#eef8fa');
    g.addColorStop(0.55, '#c3dde3');
    g.addColorStop(1, '#7fa4ae');

    ctx.beginPath();
    ctx.arc(0, 0, r, 0, Math.PI * 2);
    ctx.fillStyle = g;
    ctx.fill();

    ctx.lineWidth = 2;
    ctx.strokeStyle = '#f4fbfc';
    ctx.stroke();

    // 白色眼罩横条 + 深色描边
    ctx.save();
    ctx.beginPath();
    ctx.arc(0, 0, r - 1, 0, Math.PI * 2);
    ctx.clip();
    ctx.fillStyle = '#ffffff';
    ctx.fillRect(-r, -r * 0.26, r * 2, r * 0.3);
    ctx.strokeStyle = 'rgba(40, 65, 74, 0.55)';
    ctx.lineWidth = 1;
    ctx.strokeRect(-r, -r * 0.26, r * 2, r * 0.3);
    ctx.restore();

    // 眼罩内的深色眼缝
    ctx.fillStyle = 'rgba(30, 52, 62, 0.9)';
    ctx.fillRect(-r * 0.46, -r * 0.16, r * 0.24, r * 0.05);
    ctx.fillRect(r * 0.22, -r * 0.16, r * 0.24, r * 0.05);

    // 面部高光
    ctx.beginPath();
    ctx.arc(-r * 0.34, -r * 0.42, r * 0.16, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, 0.45)';
    ctx.fill();
  }

  function drawLifeRing(t, now) {
    var total = t.expiresAt - t.bornAt;
    var left = util.clamp((t.expiresAt - now) / total, 0, 1);
    var color = t.type === 'gangster' ? 'rgba(255, 106, 61, 0.85)' : 'rgba(233, 238, 243, 0.7)';

    ctx.beginPath();
    ctx.arc(0, 0, t.r + 7, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * left);
    ctx.strokeStyle = color;
    ctx.lineWidth = 3;
    ctx.stroke();
  }

  function drawHitFlash(t, now) {
    var k = util.clamp((now - t.hitAt) / cfg.hitFlashMs, 0, 1);
    var alpha = 1 - k * 0.55;

    ctx.beginPath();
    ctx.arc(0, 0, t.r, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, ' + alpha.toFixed(3) + ')';
    ctx.fill();

    ctx.beginPath();
    ctx.arc(0, 0, t.r + 3 + k * 12, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 255, 255, ' + (alpha * 0.8).toFixed(3) + ')';
    ctx.lineWidth = 2;
    ctx.stroke();
  }

  function drawParticles() {
    for (var i = 0; i < particles.length; i++) {
      var p = particles[i];
      var alpha = util.clamp(p.life / p.maxLife, 0, 1);

      ctx.save();
      ctx.globalAlpha = alpha;

      if (p.kind === 'shard') {
        ctx.translate(p.x, p.y);
        ctx.rotate(p.angle || 0);
        ctx.fillStyle = 'rgba(' + p.color + ',1)';
        ctx.fillRect(-p.size / 2, -p.size * 0.16, p.size, p.size * 0.32);
      } else {
        ctx.beginPath();
        ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
        ctx.fillStyle = 'rgba(' + p.color + ',1)';
        ctx.fill();
      }

      ctx.restore();
    }
  }

  function drawFloaters() {
    for (var i = 0; i < floaters.length; i++) {
      var f = floaters[i];
      var progress = util.clamp(f.life / f.maxLife, 0, 1);
      var alpha = 1 - progress;

      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.fillStyle = '#9dff72';
      ctx.font = '700 22px "Chakra Petch", "Noto Sans SC", sans-serif';
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.shadowColor = 'rgba(120, 255, 120, 0.55)';
      ctx.shadowBlur = 10;
      ctx.fillText('+1', f.x, f.y - progress * 38);
      ctx.restore();
    }
  }

  function drawMuzzle(now) {
    if (!flash || now >= flash.until) return;

    var k = util.clamp(1 - (flash.until - now) / cfg.muzzleFlashMs, 0, 1);
    var alpha = 1 - k;

    ctx.save();
    ctx.translate(flash.x, flash.y);
    ctx.strokeStyle = 'rgba(255, 255, 255, ' + alpha.toFixed(3) + ')';
    ctx.lineWidth = 2;

    for (var i = 0; i < 9; i++) {
      var angle = flash.seed + i * 0.698 + (i % 2) * 0.1;
      var len = 15 + (i % 3) * 8;
      ctx.beginPath();
      ctx.moveTo(Math.cos(angle) * 5, Math.sin(angle) * 5);
      ctx.lineTo(Math.cos(angle) * len, Math.sin(angle) * len);
      ctx.stroke();
    }

    ctx.beginPath();
    ctx.arc(0, 0, 3, 0, Math.PI * 2);
    ctx.fillStyle = 'rgba(255, 255, 255, ' + alpha.toFixed(3) + ')';
    ctx.fill();
    ctx.restore();
  }

  function drawCrosshair() {
    if (!mouse.inside) return;
    if (state !== 'running' && state !== 'countdown') return;

    var base = 16 * aimScale;

    ctx.save();
    ctx.translate(mouse.x, mouse.y);

    ctx.strokeStyle = 'rgba(233, 238, 243, 0.9)';
    ctx.lineWidth = 1.4;

    ctx.beginPath();
    ctx.arc(0, 0, base, 0, Math.PI * 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(0, 0, 2.5, 0, Math.PI * 2);
    ctx.strokeStyle = 'rgba(255, 90, 43, 0.95)';
    ctx.stroke();

    // 四向刻度，留出中心空隙
    ctx.strokeStyle = 'rgba(233, 238, 243, 0.85)';
    for (var i = 0; i < 4; i++) {
      var angle = (i * Math.PI) / 2;
      var sx = Math.cos(angle);
      var sy = Math.sin(angle);
      ctx.beginPath();
      ctx.moveTo(sx * (base + 4), sy * (base + 4));
      ctx.lineTo(sx * (base + 13), sy * (base + 13));
      ctx.stroke();
    }

    ctx.restore();
  }

  /* ---------------------------------------------------------------- 预览 */

  function previewResult() {
    resetRoundState();
    state = 'over';
    stats.hits = 7;
    stats.shots = 9;
    stats.escaped = 1;
    stats.roundsCompleted = 5;
    roundIndex = 4;
    renderHud();
    ZRD.bus.emit('game:end', {
      outcome: 'success',
      preview: true,
      stats: snapshot('success')
    });
  }

  ZRD.game = {
    init: init,
    start: start,
    reset: reset,
    stop: stop,
    resume: resume,
    resize: resize,
    previewResult: previewResult,
    debugState: function () {
      return {
        state: state,
        roundIndex: roundIndex,
        stats: {
          hits: stats.hits,
          shots: stats.shots,
          escaped: stats.escaped,
          hostageHits: stats.hostageHits,
          roundsCompleted: stats.roundsCompleted
        },
        targets: targets.map(function (t) {
          return {
            id: t.id,
            type: t.type,
            x: Math.round(t.x),
            y: Math.round(t.y),
            r: t.r,
            state: t.state
          };
        })
      };
    },
    get state() {
      return state;
    }
  };
})(window);
