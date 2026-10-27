/* ============================================================================
   results.js —— 第 3 屏：射击结算（成功 / 失败，内联覆盖在第 2 屏战场内）
   ----------------------------------------------------------------------------
   对外 API：
     ZRD.results.init()      → void
     ZRD.results.open(data)  → void   data = { outcome, stats }
     ZRD.results.close(immediate) → void
     ZRD.results.isOpen      → boolean

   职责：只负责渲染结算层与按钮行为，不参与游戏循环。
   ========================================================================== */

(function (global) {
  'use strict';

  var ZRD = global.ZRD;
  var util = ZRD.util;

  var dom = {};
  var isOpen = false;
  var closeTimer = 0;
  var current = null;

  function init() {
    dom.panel = util.el('#result-panel');
    dom.tag = util.el('#result-tag');
    dom.grade = util.el('#result-grade');
    dom.gradeK = util.el('#result-grade-k');
    dom.headline = util.el('#result-headline');
    dom.sub = util.el('#result-sub');
    dom.extra = util.el('#result-extra');
    dom.replayBtn = util.el('#btn-replay');
    dom.topBtn = util.el('#btn-top');

    dom.stats = {
      hits: util.el('#stat-hits'),
      shots: util.el('#stat-shots'),
      acc: util.el('#stat-acc'),
      escaped: util.el('#stat-escaped')
    };

    if (!dom.panel) return;

    util.on(dom.replayBtn, 'click', function () {
      close(true);
      if (ZRD.game) ZRD.game.start();
    });

    util.on(dom.topBtn, 'click', function () {
      backToTop();
    });

    util.on(document, 'keydown', function (e) {
      if (e.key === 'Escape' && isOpen) backToTop();
    });
  }

  function backToTop() {
    close(true);
    if (ZRD.game) ZRD.game.reset();
    var hero = util.el('#screen-hero');
    if (hero) hero.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  /* ---------------------------------------------------------------- 渲染 */

  function render(payload) {
    var stats = (payload && payload.stats) || {};
    var fail = payload && payload.outcome === 'fail';
    var hits = stats.hits || 0;
    var shots = stats.shots || 0;
    var escaped = stats.escaped || 0;
    var round = stats.round || 5;

    dom.panel.classList.toggle('is-fail', !!fail);
    dom.panel.classList.toggle('is-success', !fail);

    if (dom.tag) dom.tag.textContent = fail ? 'MISSION FAILED' : 'MISSION CLEAR';
    if (dom.grade) dom.grade.textContent = fail ? '×' : '✓';
    if (dom.gradeK) dom.gradeK.textContent = fail ? 'FAILED' : 'CLEAR';

    if (dom.headline) {
      dom.headline.textContent = fail
        ? '任务失败——你击中了人质'
        : '挑战成功';
    }

    if (dom.sub) {
      dom.sub.textContent = fail
        ? '本局在第 ' + round + ' 组终止 · 未完成的组不再继续'
        : '5 组目标已清空 · 未误伤人质';
    }

    if (dom.stats.hits) dom.stats.hits.textContent = String(hits);
    if (dom.stats.shots) dom.stats.shots.textContent = String(shots);
    if (dom.stats.escaped) dom.stats.escaped.textContent = String(escaped);

    if (dom.stats.acc) {
      dom.stats.acc.textContent =
        shots > 0
          ? hits + ' / ' + shots + ' · ' + Math.round((hits / shots) * 100) + '%'
          : '—';
    }

    if (dom.extra) {
      if (fail) {
        dom.extra.hidden = true;
        dom.extra.textContent = '';
      } else {
        dom.extra.hidden = false;
        dom.extra.textContent = '漏网悍匪：' + escaped + ' 名';
      }
    }
  }

  /* ---------------------------------------------------------------- 开合 */

  function open(payload) {
    if (!dom.panel) return;

    current = payload;
    render(payload);

    global.clearTimeout(closeTimer);
    dom.panel.hidden = false;
    dom.panel.setAttribute('aria-hidden', 'false');
    global.requestAnimationFrame(function () {
      dom.panel.classList.add('is-open');
    });

    isOpen = true;
    document.body.style.overflow = 'hidden';
    document.documentElement.style.overflow = 'hidden';

    if (dom.replayBtn) {
      global.setTimeout(function () {
        dom.replayBtn.focus({ preventScroll: true });
      }, 80);
    }

    ZRD.bus.emit('result:open', { outcome: payload && payload.outcome });
  }

  function close(immediate) {
    if (!dom.panel || !isOpen) return;

    isOpen = false;
    dom.panel.classList.remove('is-open');
    dom.panel.setAttribute('aria-hidden', 'true');
    document.body.style.overflow = '';
    document.documentElement.style.overflow = '';

    global.clearTimeout(closeTimer);
    if (immediate) {
      dom.panel.hidden = true;
    } else {
      closeTimer = global.setTimeout(function () {
        if (!isOpen) dom.panel.hidden = true;
      }, 420);
    }

    ZRD.bus.emit('result:close', {});
  }

  function preview() {
    open({
      outcome: 'success',
      preview: true,
      stats: {
        hits: 7,
        shots: 9,
        escaped: 1,
        hostageHits: 0,
        accuracy: 7 / 9,
        roundsCompleted: 5,
        round: 5
      }
    });
  }

  ZRD.results = {
    init: init,
    open: open,
    close: close,
    preview: preview,
    get isOpen() {
      return isOpen;
    }
  };
})(window);
