/* ============================================================================
   main.js —— 启动、环境检查、跨模块接线、滚动监听
   ----------------------------------------------------------------------------
   启动顺序：
     1) 环境体检（Three.js / MediaPipe / WebGL / file://）
     2) 初始化 game → results → hero
     3) 接线：game:end → results.open；sys:note → 顶部提示条
     4) 滚动 / 可见性 / 调试参数

   调试参数：
     ?debug          控制台输出状态迁移
     ?reveal         直接进入“姓名 + 评分”态（跳过手势，验收排版）
     ?preview=result 用假数据打开结算层，验收第 3 屏排版
   ========================================================================== */

(function (global) {
  'use strict';

  var ZRD = global.ZRD;
  var util = ZRD.util;

  var noteTimer = 0;
  var noteEl = null;
  var booted = false;
  var gameWasRunning = false;

  /* ---------------------------------------------------------------- 声音
     Web Audio 程序化合成，无外链音频文件。
     首次点击 / 滚动 / 触摸时创建 AudioContext；后续每次调用都会尝试 resume。
     ------------------------------------------------------------------ */

  var audioCtx = null;
  var audioMaster = null;
  var audioNoise = null;
  var audioUnlockBound = false;

  function makeAudioContext() {
    var AC = global.AudioContext || global.webkitAudioContext;
    if (!AC) return null;

    if (!audioCtx) {
      try {
        audioCtx = new AC();
        audioMaster = audioCtx.createGain();
        audioMaster.gain.value = 0.22;

        var comp = audioCtx.createDynamicsCompressor();
        comp.threshold.value = -18;
        comp.knee.value = 18;
        comp.ratio.value = 4;
        comp.attack.value = 0.003;
        comp.release.value = 0.25;

        audioMaster.connect(comp);
        comp.connect(audioCtx.destination);
      } catch (e) {
        audioCtx = null;
        audioMaster = null;
        return null;
      }
    }

    if (audioCtx.state === 'suspended') {
      try {
        var resumed = audioCtx.resume();
        if (resumed && resumed.catch) resumed.catch(function () {});
      } catch (e) {
        /* 自动播放策略下可能仍保持 suspended，静默降级 */
      }
    }

    return audioCtx;
  }

  function audioTime(ctx) {
    return ctx.currentTime + 0.005;
  }

  function getNoiseBuffer(ctx) {
    if (audioNoise) return audioNoise;
    var length = Math.floor(ctx.sampleRate * 0.3);
    audioNoise = ctx.createBuffer(1, length, ctx.sampleRate);
    var data = audioNoise.getChannelData(0);
    for (var i = 0; i < length; i++) data[i] = Math.random() * 2 - 1;
    return audioNoise;
  }

  /** 高频风铃 / 能量扩散：多个振荡器 + 高→低扫频 + 气声 */
  function playBloomSound() {
    var ctx = makeAudioContext();
    if (!ctx || !audioMaster) return;

    var t0 = audioTime(ctx);
    var bus = ctx.createGain();
    bus.gain.value = 0.9;
    bus.connect(audioMaster);

    var chimes = [2093, 2637, 3136, 4186];
    for (var i = 0; i < chimes.length; i++) {
      var start = t0 + i * 0.018;
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      var pan = ctx.createStereoPanner ? ctx.createStereoPanner() : null;

      osc.type = i % 2 === 0 ? 'sine' : 'triangle';
      osc.frequency.setValueAtTime(chimes[i], start);
      osc.frequency.exponentialRampToValueAtTime(chimes[i] * 0.42, start + 0.62);

      gain.gain.setValueAtTime(0.0001, start);
      gain.gain.exponentialRampToValueAtTime(0.13 / (1 + i * 0.35), start + 0.008);
      gain.gain.exponentialRampToValueAtTime(0.0001, start + 0.7 + i * 0.08);

      if (pan) {
        pan.pan.value = (i / (chimes.length - 1)) * 1.2 - 0.6;
        osc.connect(gain);
        gain.connect(pan);
        pan.connect(bus);
      } else {
        osc.connect(gain);
        gain.connect(bus);
      }

      osc.start(start);
      osc.stop(start + 0.95 + i * 0.08);
    }

    var noise = ctx.createBufferSource();
    noise.buffer = getNoiseBuffer(ctx);
    var band = ctx.createBiquadFilter();
    band.type = 'bandpass';
    band.Q.value = 1.1;
    band.frequency.setValueAtTime(4200, t0);
    band.frequency.exponentialRampToValueAtTime(900, t0 + 0.7);

    var noiseGain = ctx.createGain();
    noiseGain.gain.setValueAtTime(0.0001, t0);
    noiseGain.gain.exponentialRampToValueAtTime(0.055, t0 + 0.04);
    noiseGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.75);

    noise.connect(band);
    band.connect(noiseGain);
    noiseGain.connect(bus);
    noise.start(t0);
    noise.stop(t0 + 0.8);

    var sub = ctx.createOscillator();
    var subGain = ctx.createGain();
    sub.type = 'sine';
    sub.frequency.setValueAtTime(180, t0);
    sub.frequency.exponentialRampToValueAtTime(90, t0 + 0.55);
    subGain.gain.setValueAtTime(0.0001, t0);
    subGain.gain.exponentialRampToValueAtTime(0.09, t0 + 0.035);
    subGain.gain.exponentialRampToValueAtTime(0.0001, t0 + 0.85);
    sub.connect(subGain);
    subGain.connect(bus);
    sub.start(t0);
    sub.stop(t0 + 0.9);
  }

  /** 枪声：白噪声 + 低通扫频 + 极短包络 + 低频枪身 */
  function playShotSound() {
    var ctx = makeAudioContext();
    if (!ctx || !audioMaster) return;

    var t = audioTime(ctx);

    var noise = ctx.createBufferSource();
    noise.buffer = getNoiseBuffer(ctx);
    noise.playbackRate.value = 0.9 + Math.random() * 0.2;

    var lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.Q.value = 0.7;
    lowpass.frequency.setValueAtTime(2400, t);
    lowpass.frequency.exponentialRampToValueAtTime(300, t + 0.09);

    var gain = ctx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.62, t + 0.003);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.11);

    noise.connect(lowpass);
    lowpass.connect(gain);
    gain.connect(audioMaster);
    noise.start(t);
    noise.stop(t + 0.16);

    var body = ctx.createOscillator();
    var bodyGain = ctx.createGain();
    body.type = 'sine';
    body.frequency.setValueAtTime(150, t);
    body.frequency.exponentialRampToValueAtTime(55, t + 0.1);
    bodyGain.gain.setValueAtTime(0.0001, t);
    bodyGain.gain.exponentialRampToValueAtTime(0.2, t + 0.004);
    bodyGain.gain.exponentialRampToValueAtTime(0.0001, t + 0.12);
    body.connect(bodyGain);
    bodyGain.connect(audioMaster);
    body.start(t);
    body.stop(t + 0.14);
  }

  /** 命中悍匪：高频短促的“叮” */
  function playHitSound() {
    var ctx = makeAudioContext();
    if (!ctx || !audioMaster) return;

    var t = audioTime(ctx);
    var freqs = [1760, 2637, 3520];

    for (var i = 0; i < freqs.length; i++) {
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = i === 1 ? 'triangle' : 'sine';
      osc.frequency.setValueAtTime(freqs[i], t + i * 0.008);
      osc.frequency.exponentialRampToValueAtTime(freqs[i] * 0.99, t + 0.18);

      gain.gain.setValueAtTime(0.0001, t + i * 0.008);
      gain.gain.exponentialRampToValueAtTime(0.2 / (i + 1), t + i * 0.008 + 0.004);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.2 + i * 0.03);

      osc.connect(gain);
      gain.connect(audioMaster);
      osc.start(t + i * 0.008);
      osc.stop(t + 0.25 + i * 0.03);
    }
  }

  /** 误伤人质：低频沉闷的“嗡” */
  function playFailSound() {
    var ctx = makeAudioContext();
    if (!ctx || !audioMaster) return;

    var t = audioTime(ctx);
    var lowpass = ctx.createBiquadFilter();
    lowpass.type = 'lowpass';
    lowpass.frequency.setValueAtTime(520, t);
    lowpass.frequency.exponentialRampToValueAtTime(180, t + 0.7);
    lowpass.Q.value = 0.9;
    lowpass.connect(audioMaster);

    var freqs = [110, 82];
    for (var i = 0; i < freqs.length; i++) {
      var osc = ctx.createOscillator();
      var gain = ctx.createGain();
      osc.type = i === 0 ? 'sine' : 'triangle';
      osc.frequency.setValueAtTime(freqs[i], t);
      osc.frequency.exponentialRampToValueAtTime(freqs[i] * 0.45, t + 0.55);

      gain.gain.setValueAtTime(0.0001, t);
      gain.gain.exponentialRampToValueAtTime(0.2 / (i + 1), t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.75);

      osc.connect(gain);
      gain.connect(lowpass);
      osc.start(t);
      osc.stop(t + 0.8);
    }
  }

  function initAudioUnlock() {
    if (audioUnlockBound) return;
    audioUnlockBound = true;

    var events = ['pointerdown', 'keydown', 'touchstart', 'wheel', 'scroll'];
    for (var i = 0; i < events.length; i++) {
      global.addEventListener(events[i], makeAudioContext, { passive: true, capture: true });
    }

    document.addEventListener('visibilitychange', function () {
      if (document.hidden && audioCtx && audioCtx.state === 'running') {
        try {
          var paused = audioCtx.suspend();
          if (paused && paused.catch) paused.catch(function () {});
        } catch (e) {
          /* 忽略 */
        }
      }
    });
  }

  ZRD.audio = {
    ensure: makeAudioContext,
    bloom: playBloomSound,
    shot: playShotSound,
    hit: playHitSound,
    fail: playFailSound,
    get state() {
      return audioCtx ? audioCtx.state : 'uninitialized';
    }
  };

  /* ---------------------------------------------------------------- 环境 */

  function webglOK() {
    try {
      var c = document.createElement('canvas');
      return !!(c.getContext('webgl2') || c.getContext('webgl'));
    } catch (e) {
      return false;
    }
  }

  function checkEnv() {
    if (!global.THREE) {
      note('Three.js 未能从 CDN 加载：粒子区降级为静态花苞，其余功能不受影响。', 7000);
    } else if (!webglOK()) {
      note('当前环境未启用 WebGL：粒子区降级为静态花苞。', 7000);
    }

    if (!global.Hands) {
      note('MediaPipe Hands 未能加载（CDN / 网络）：手势不可用，可点按手动绽放。', 7000);
    }
  }

  /* ---------------------------------------------------------------- 提示条 */

  function initNote() {
    noteEl = util.el('#sys-note');
    ZRD.bus.on('sys:note', function (payload) {
      if (!payload || !payload.text) return;
      note(payload.text, payload.ttl || 4200);
    });
  }

  function note(text, ttl) {
    if (!noteEl) return;
    global.clearTimeout(noteTimer);
    noteEl.textContent = text;
    noteEl.hidden = false;

    // 同一时间只显示一条；后到的覆盖先到的
    noteTimer = global.setTimeout(function () {
      noteEl.hidden = true;
    }, ttl || 4200);
  }

  /* ---------------------------------------------------------------- 接线 */

  function heroInView() {
    var hero = util.el('#screen-hero');
    if (!hero) return false;
    var rect = hero.getBoundingClientRect();
    return rect.bottom > 0 && rect.top < (global.innerHeight || 0);
  }

  function wire() {
    ZRD.bus.on('game:end', function (payload) {
      if (!payload || !payload.stats) return;
      ZRD.results.open(payload);
    });

    ZRD.bus.on('result:open', function () {
      var rail = util.el('.rail__item[data-nav="03"]');
      if (rail) rail.removeAttribute('aria-disabled');
      ZRD.particles.setPaused(true);
    });

    ZRD.bus.on('result:close', function () {
      var rail = util.el('.rail__item[data-nav="03"]');
      if (rail) rail.setAttribute('aria-disabled', 'true');
      // 结算层在第 2 屏内；关闭后仍离屏时保持粒子暂停
      ZRD.particles.setPaused(!heroInView());
    });

    ZRD.bus.on('particle:bloom-end', function () {
      if (!heroInView()) ZRD.particles.setPaused(true);
    });

    ZRD.bus.on('rating:change', function (payload) {
      util.log('rating:', payload.value);
    });
  }

  /* ---------------------------------------------------------------- 滚动 */

  function initScroll() {
    var sections = [util.el('#screen-hero'), util.el('#screen-challenge')].filter(Boolean);
    var railItems = util.els('.rail__item');

    if ('IntersectionObserver' in global) {
      var spy = new IntersectionObserver(
        function (entries) {
          entries.forEach(function (entry) {
            if (!entry.isIntersecting) return;
            var id = entry.target.id;
            railItems.forEach(function (item) {
              var match = item.getAttribute('href') === '#' + id;
              item.classList.toggle('is-active', match);
            });
          });
        },
        { threshold: 0.4 }
      );
      sections.forEach(function (s) {
        spy.observe(s);
      });

      // 第 1 屏离屏时暂停粒子，省电；但绽开动画播到一半时不打断
      var hero = util.el('#screen-hero');
      if (hero) {
        var heroSpy = new IntersectionObserver(
          function (entries) {
            entries.forEach(function (entry) {
              if (ZRD.results.isOpen) return;
              if (!entry.isIntersecting && ZRD.particles.phase === 'blooming') return;
              ZRD.particles.setPaused(!entry.isIntersecting);
            });
          },
          { threshold: 0.05 }
        );
        heroSpy.observe(hero);
      }
    }

    // 点击第 3 个导航点：若结算层已打开，滚到战场
    railItems.forEach(function (item) {
      if (item.getAttribute('data-nav') !== '03') return;
      util.on(item, 'click', function (e) {
        if (!ZRD.results.isOpen) {
          e.preventDefault();
          return;
        }
      });
    });
  }

  /* ---------------------------------------------------------------- 可见性 */

  function initVisibility() {
    util.on(document, 'visibilitychange', function () {
      if (document.hidden) {
        gameWasRunning = ZRD.game.state === 'running' || ZRD.game.state === 'countdown';
        ZRD.particles.setPaused(true);
        ZRD.game.stop();
        if (ZRD.hands && ZRD.hands.stop) ZRD.hands.stop();
      } else {
        ZRD.particles.setPaused(!heroInView());
        if (ZRD.hero && (ZRD.hero.phase === 'ready' || ZRD.hero.phase === 'camera-loading')) {
          if (ZRD.hands && ZRD.hands.start) ZRD.hands.start();
        }
        if (gameWasRunning && !ZRD.results.isOpen) {
          ZRD.game.resume();
        }
        gameWasRunning = false;
      }
    });
  }

  /* ---------------------------------------------------------------- 杂项 */

  function initMisc() {
    var year = util.el('#year');
    if (year) year.textContent = String(new Date().getFullYear());

    // 声音系统已接入，更新控制台底栏的旧文案（只改文本，不改结构）
    var audioLabel = util.el('.console__foot span:last-child');
    if (audioLabel) audioLabel.textContent = 'AUDIO · WEB AUDIO';

    // 数据层不可用（隐私模式）时提示一次
    if (!ZRD.store.available) {
      note('浏览器禁用了 localStorage：评分与本地记录仅在本次会话内有效。', 6000);
    }
  }

  function initDebug() {
    var params;
    try {
      params = new URLSearchParams(global.location.search);
    } catch (e) {
      return;
    }

    if (params.has('reveal')) {
      global.setTimeout(function () {
        ZRD.hero.reveal();
      }, 0);
    } else if (params.has('final')) {
      // 仅调试：跳过动画直接看绽放终态 + 评分排版
      global.setTimeout(function () {
        ZRD.particles.debugBloom();
        ZRD.hero.reveal();
      }, 0);
    } else if (params.has('bloom')) {
      // 预览完整的 2.8s 绽开 + 评分浮现
      global.setTimeout(function () {
        ZRD.hero.beginBloom('tap');
      }, 300);
    }

    if (params.has('flat')) {
      // 仅调试：关闭平滑滚动，直接落到第 2 屏（截图/验收用）
      document.documentElement.style.scrollBehavior = 'auto';
      var challenge = util.el('#screen-challenge');
      if (challenge) challenge.scrollIntoView({ block: 'start', behavior: 'instant' });
    }

    if (params.get('preview') === 'result') {
      global.setTimeout(function () {
        var field = util.el('#field');
        if (field) field.scrollIntoView({ block: 'center', behavior: 'instant' });
        ZRD.game.previewResult();
      }, 0);
    }
  }

  function initResize() {
    var t = 0;
    util.on(global, 'resize', function () {
      global.clearTimeout(t);
      t = global.setTimeout(function () {
        ZRD.particles.resize();
        ZRD.game.resize();
      }, 120);
    });
  }

  /* ---------------------------------------------------------------- 启动 */

  function boot() {
    if (booted) return;
    booted = true;

    initNote();
    initAudioUnlock();
    checkEnv();

    if (!ZRD.game || !ZRD.results || !ZRD.hero) {
      console.error('[ZRD] 模块缺失，检查脚本顺序');
      return;
    }

    ZRD.game.init({});
    ZRD.results.init();
    ZRD.hero.init();

    wire();
    initScroll();
    initVisibility();
    initResize();
    initMisc();
    initDebug();

    // 调试句柄：控制台可直接 __ZRD__.hero.reveal() 等
    global.__ZRD__ = ZRD;

    util.log('booted', ZRD.config.version, {
      mobile: util.isMobile(),
      file: util.isFileProtocol(),
      reduced: util.prefersReducedMotion()
    });
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', boot, { once: true });
  } else {
    boot();
  }
})(window);
