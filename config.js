/* ============================================================================
   config.js —— 全局命名空间 / 常量 / 工具函数 / 微型事件总线
   职责：只放契约与纯函数，不碰 DOM、不渲染、不读 localStorage
   说明：只放常量与纯函数；粒子数 / 组数 / 存活时间等可在此统一调参
   ========================================================================== */

(function (global) {
  'use strict';

  var ZRD = (global.ZRD = global.ZRD || {});

  ZRD.config = {
    version: '0.1.0-skeleton',

    /* localStorage 键名统一前缀；ratings 按需求使用下划线键名 */
    keys: {
      ratings: 'zrd_ratings',
      best: 'zrd:best:v1',
      history: 'zrd:history:v1'
    },

    /* —— A 模块：粒子 —— */
    particle: {
      count: 4200,           // 桌面端粒子数（要求 3000~5000）
      countMobile: 3000,     // 移动端降级
      dprCap: 2,             // devicePixelRatio 上限
      bloomDuration: 2.8,    // 聚拢 → 绽开 的时长（秒），要求 2.5~3
      bloomCoverage: 0.68,   // 绽开直径约占视口短边的比例
      driftIdle: 0.012,      // 花苞态漂浮幅度
      driftBloom: 0.05,      // 绽开后漂浮幅度
      palette: {
        cold: 0x2f7c8c,      // 冷色（初始花苞）
        warm: 0xff5a2b,      // 暖色（绽放后主色）
        gold: 0xffb85c       // 暖色高光
      }
    },

    /* —— 手势识别 —— */
    hand: {
      maxNumHands: 1,
      modelComplexity: 1,
      minDetectionConfidence: 0.6,
      minTrackingConfidence: 0.6,
      openPalmThreshold: 1.5,  // 指尖/ PIP 到腕距离比 > 1.5
      openPalmHoldMs: 500,     // 四指同时满足并连续保持 500ms
      noHandHintMs: 10000,     // 10 秒未检测到手 → 追加光线/距离提示
      sendIntervalMs: 33,      // MediaPipe 送帧节流（≈30fps）
      cdnBase: 'https://cdn.jsdelivr.net/npm/@mediapipe/hands@0.4.1675469240/'
    },

    /* —— B 模块：射击 —— */
    game: {
      // 5 组，目标存活时间逐组缩短（ms）
      rounds: [2500, 2000, 1600, 1300, 1000],
      minTargets: 2,
      maxTargets: 4,
      countdownMs: 2400,
      roundGapMs: 650,
      hitFlashMs: 140,
      muzzleFlashMs: 50,
      hitParticles: 12
    },

    /* —— 评分 —— */
    rating: {
      labels: ['再想想', '有点勉强', '还不错', '相当可以', '满分收下']
    },

    breakpoints: { mobile: 820 },

    /* 调试：?debug 打开控制台日志；?nofx 关闭重动效（骨架期占位） */
    debug: (function () {
      try {
        return new URLSearchParams(global.location.search).has('debug');
      } catch (e) {
        return false;
      }
    })()
  };

  /* ==========================================================================
     工具函数
     ========================================================================== */

  function clamp(v, min, max) {
    return v < min ? min : v > max ? max : v;
  }

  function lerp(a, b, t) {
    return a + (b - a) * t;
  }

  function rand(min, max) {
    return min + Math.random() * (max - min);
  }

  function randInt(min, max) {
    return Math.floor(rand(min, max + 1));
  }

  function easeOutCubic(t) {
    var p = 1 - t;
    return 1 - p * p * p;
  }

  function easeInOutCubic(t) {
    return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
  }

  function now() {
    return global.performance && global.performance.now
      ? global.performance.now()
      : Date.now();
  }

  function isMobile() {
    return global.matchMedia
      ? global.matchMedia('(max-width: ' + ZRD.config.breakpoints.mobile + 'px)').matches
      : global.innerWidth <= ZRD.config.breakpoints.mobile;
  }

  /** 双击打开 file:// 时，摄像头与 MediaPipe 的 wasm 拉取都会被浏览器拦下 */
  function isFileProtocol() {
    return global.location.protocol === 'file:';
  }

  function prefersReducedMotion() {
    return !!(
      global.matchMedia &&
      global.matchMedia('(prefers-reduced-motion: reduce)').matches
    );
  }

  /** 毫秒 → “0.42s” / “—” */
  function formatSeconds(ms) {
    if (ms == null || !isFinite(ms)) return '—';
    return (ms / 1000).toFixed(2) + 's';
  }

  function formatPct(v) {
    if (v == null || !isFinite(v)) return '—';
    return Math.round(v * 100) + '%';
  }

  function pad(n, len) {
    var s = String(Math.max(0, Math.floor(n)));
    while (s.length < (len || 4)) s = '0' + s;
    return s;
  }

  function el(sel, root) {
    return (root || document).querySelector(sel);
  }

  function els(sel, root) {
    return Array.prototype.slice.call((root || document).querySelectorAll(sel));
  }

  function on(target, type, handler, opts) {
    if (!target) return function () {};
    target.addEventListener(type, handler, opts);
    return function () {
      target.removeEventListener(type, handler, opts);
    };
  }

  function log() {
    if (!ZRD.config.debug) return;
    var args = Array.prototype.slice.call(arguments);
    args.unshift('%c[ZRD]', 'color:#c9f24d');
    console.log.apply(console, args);
  }

  /* ==========================================================================
     事件总线：模块之间只通过事件通信，避免互相引用
     事件清单（约定）
       hand:open            开掌判定通过（一次事件，不重复触发）
       hand:status          状态变化 { phase, message }
       hand:error           摄像头/模型异常 { code, message }
       particle:bud         花苞聚拢完成
       particle:bloom-end   绽放动画结束
       hero:reveal          姓名 + 评分浮现
       rating:change        { value }
       game:start / game:tick / game:hit / game:miss
       game:end             { stats }
       result:open / result:close
     ========================================================================== */
  var listeners = {};

  ZRD.bus = {
    on: function (name, fn) {
      (listeners[name] || (listeners[name] = [])).push(fn);
      return function () {
        ZRD.bus.off(name, fn);
      };
    },
    off: function (name, fn) {
      var arr = listeners[name];
      if (!arr) return;
      var i = arr.indexOf(fn);
      if (i > -1) arr.splice(i, 1);
    },
    emit: function (name, payload) {
      var arr = listeners[name];
      if (!arr || !arr.length) return;
      arr.slice().forEach(function (fn) {
        try {
          fn(payload);
        } catch (err) {
          console.error('[ZRD] listener error:', name, err);
        }
      });
    }
  };

  ZRD.util = {
    clamp: clamp,
    lerp: lerp,
    rand: rand,
    randInt: randInt,
    easeOutCubic: easeOutCubic,
    easeInOutCubic: easeInOutCubic,
    now: now,
    isMobile: isMobile,
    isFileProtocol: isFileProtocol,
    prefersReducedMotion: prefersReducedMotion,
    formatSeconds: formatSeconds,
    formatPct: formatPct,
    pad: pad,
    el: el,
    els: els,
    on: on,
    log: log
  };
})(window);
