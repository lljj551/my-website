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
