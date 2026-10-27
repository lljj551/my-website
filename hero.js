/* ============================================================================
   hero.js —— 第 1 屏流程编排（摄像头 / 手势 / 粒子 / 五星评分）
   ----------------------------------------------------------------------------
   状态机：
     boot → camera-loading → ready（花苞） → blooming → revealed
                         ↘ fallback（file:// / 移动端 / 摄像头异常）

   规则：
     - 页面加载即请求摄像头，Three.js 场景先于摄像头完成初始化
     - 中央文案固定为“请将手掌正对摄像头，然后张开手指”
     - 开掌判定交给 hand-tracker（四指伸展比 > 1.5，连续 500ms）
     - 绽开结束后才淡入姓名与评分；随后关闭摄像头、停止手势
     - 10 秒未检测到手：在提示下方追加光线与距离提示
   ========================================================================== */

(function (global) {
  'use strict';

  var ZRD = global.ZRD;
  var cfg = ZRD.config;
  var util = ZRD.util;

  var PROMPT = '请将手掌正对摄像头，然后张开手指';
  var NO_HAND_TIP = '没有检测到手？请确保光线充足，手掌距离摄像头 40~80cm';

  var COPY = {
    loading: { sub: '正在请求摄像头权限…' },
    initializing: { sub: '正在加载手势模型…' },
    ready: { sub: '将手掌放入右下角取景框 · 五指张开并保持 0.5 秒' },
    tracking: { sub: '已检测到手 · 五指张开并保持 0.5 秒' },
    nohand: { sub: '没有检测到手 · 请把手掌正对镜头' },
    blooming: { prompt: '正在绽放', sub: '信号已接收 · 请稍候' },
    fallback: { sub: '摄像头不可用 · 可点按下方按钮手动绽放' }
  };

  var section = null;
  var phase = 'boot';
  var revealed = false;
  var bloomPromise = null;
  var handsStarted = false;

  var ratingValue = 0;
  var noteTimer = 0;
  var noHandTimer = 0;
  var noHandTimerFired = false;
  var handSeenOnce = false;

  var dom = {};

  /* ---------------------------------------------------------------- 初始化 */

  function init() {
    section = util.el('#screen-hero');
    dom.prompt = util.el('#hero-prompt');
    dom.sub = util.el('#hero-sub');
    dom.hint = util.el('#hero-hint');
    dom.hintNote = util.el('#hero-hint-note');
    dom.reveal = util.el('#hero-reveal');
    dom.fallback = util.el('#hero-fallback');
    dom.cam = util.el('#cam-dock');
    dom.camState = util.el('#cam-state');
    dom.camMeter = util.el('#cam-meter');
    dom.video = util.el('#camera-video');
    dom.meta = util.el('#hero-meta');
    dom.rating = util.el('#rating');
    dom.ratingAvg = util.el('#rating-avg');
    dom.ratingCount = util.el('#rating-count');
    dom.ratingLabel = util.el('#rating-label');
    dom.ratingSaved = util.el('#rating-saved');
    dom.ratingLast = util.el('#rating-last');
    dom.stars = util.els('.rating__star', dom.rating);

    if (!section) return;

    bindFallback();
    bindRating();
    loadRatings();

    bindBus();

    // 先初始化粒子：即使摄像头不可用，也能手动绽放
    var particlesOK = ZRD.particles.init(util.el('#particle-stage'));
    section.classList.toggle('is-live', !!particlesOK);

    if (util.isMobile()) {
      // 移动端不请求摄像头，手势降级为触摸评分 + 点按绽放
      setPhase('fallback');
      setCopy('当前设备建议使用桌面端', '触屏可完成评分与射击 · 手势绽放需桌面端摄像头');
      showNote('手势绽放需要摄像头与本地 HTTP 服务，请在桌面端体验。', true, 'mobile');
      showFallback();
      return;
    }

    if (util.isFileProtocol()) {
      setPhase('fallback');
      setCopy(PROMPT, '本地文件模式 · 摄像头不可用');
      showNote('点按下方按钮手动绽放；需要手势请用本地 HTTP 服务打开。', true, 'insecure');
      showFallback();
      return;
    }

    startCamera();
  }

  function bindBus() {
    ZRD.bus.on('hand:status', onHandStatus);
    ZRD.bus.on('hand:track', onHandTrack);
    ZRD.bus.on('hand:open', onHandOpen);
    ZRD.bus.on('hand:error', onHandError);
    ZRD.bus.on('particles:error', onParticlesError);
  }

  /* ---------------------------------------------------------------- 摄像头 */

  function startCamera() {
    setPhase('camera-loading');
    setCopy(PROMPT, COPY.loading.sub);

    ZRD.hands.init(dom.video).then(function (ok) {
      if (!ok) {
        // 具体原因已经由 hand:error 写入提示条
        showFallback();
      }
    });
  }

  function onHandStatus(evt) {
    if (revealed || phase === 'blooming' || !evt) return;

    switch (evt.phase) {
      case 'loading':
        setCopy(PROMPT, COPY.loading.sub);
        break;

      case 'initializing':
        setCopy(PROMPT, COPY.initializing.sub);
        break;

      case 'ready':
        if (dom.cam) dom.cam.classList.add('is-live');
        if (dom.camState) dom.camState.textContent = 'LIVE';
        if (dom.meta) dom.meta.textContent = 'CAM 01 · ONLINE';
        if (dom.camMeter) dom.camMeter.style.transform = 'scaleX(0)';
        setPhase('ready');
        setCopy(PROMPT, COPY.ready.sub);
        ZRD.particles.setPhase('bud');
        armNoHandTimer();
        if (!handsStarted) {
          handsStarted = true;
          ZRD.hands.start();
        }
        break;

      case 'tracking':
        markHandSeen();
        if (dom.camState) dom.camState.textContent = 'HAND';
        setCopy(PROMPT, COPY.tracking.sub);
        break;

      case 'no-hand':
        if (dom.camState) dom.camState.textContent = 'NO HAND';
        if (dom.camMeter) dom.camMeter.style.transform = 'scaleX(0)';
        setCopy(PROMPT, COPY.nohand.sub);
        if (noHandTimerFired && !handSeenOnce) showNoHandTip();
        break;

      default:
        break;
    }
  }

  function onHandTrack(payload) {
    if (revealed || phase === 'blooming' || !payload) return;

    if (!payload.present) {
      if (dom.camState) dom.camState.textContent = 'NO HAND';
      if (dom.camMeter) dom.camMeter.style.transform = 'scaleX(0)';
      setCopy(PROMPT, COPY.nohand.sub);
      return;
    }

    markHandSeen();

    var target = payload.holdTarget || cfg.hand.openPalmHoldMs;
    var hold = Math.min(payload.holdMs || 0, target);
    var ratio = target ? util.clamp(hold / target, 0, 1) : 0;

    if (dom.camState) {
      dom.camState.textContent =
        hold > 0 ? 'HOLD ' + (hold / 1000).toFixed(1) + 's' : 'HAND ' + Math.round(payload.score * 100) + '%';
    }
    if (dom.camMeter) dom.camMeter.style.transform = 'scaleX(' + ratio + ')';

    if (hold > 0) {
      setCopy(
        PROMPT,
        '保持张开 · ' + (hold / 1000).toFixed(1) + ' / ' + (target / 1000).toFixed(1) + 's'
      );
    } else {
      setCopy(PROMPT, COPY.tracking.sub);
    }
  }

  function onHandOpen() {
    if (revealed) return;
    if (dom.camState) dom.camState.textContent = 'SIGNAL';
    if (dom.camMeter) dom.camMeter.style.transform = 'scaleX(1)';
    beginBloom('hand');
  }

  function onHandError(evt) {
    if (revealed || phase === 'blooming') return;

    if (ZRD.hands && ZRD.hands.stop) ZRD.hands.stop();
    if (ZRD.hands && ZRD.hands.dispose) {
      try {
        ZRD.hands.dispose();
      } catch (err) {
        /* 忽略 */
      }
    }

    setPhase('fallback');
    if (dom.cam) dom.cam.classList.remove('is-live');
    if (dom.camState) dom.camState.textContent = 'OFFLINE';
    clearNoHandTimer();

    // 摄像头失败不应阻塞评分：直接展示姓名 + 五星，粒子保持花苞的缓慢漂浮
    ZRD.bus.emit('sys:note', {
      text: mapHandError(evt) + ' · 已跳过手势，可直接评分。',
      ttl: 7000
    });
    hideFallback();
    reveal();
  }

  function onParticlesError() {
    if (revealed) return;
    ZRD.bus.emit('sys:note', {
      text: '粒子渲染中断 · 已跳过绽放，可直接评分。',
      ttl: 7000
    });
    hideFallback();
    reveal();
  }

  function mapHandError(evt) {
    if (!evt) return '摄像头不可用';
    if (evt.code === 'denied') return '摄像头权限被拒绝';
    if (evt.code === 'insecure') return '摄像头需要 http://localhost 或 HTTPS';
    if (evt.code === 'no-camera') return '未检测到摄像头';
    if (evt.code === 'no-model' || evt.code === 'send-failed') {
      return '手势模型加载失败（检查 CDN / 网络）';
    }
    if (evt.code === 'busy') return '摄像头被其他程序占用';
    return '摄像头初始化失败';
  }

  /* ---------------------------------------------------------------- 10 秒提示 */

  function armNoHandTimer() {
    clearNoHandTimer();
    noHandTimerFired = false;
    if (handSeenOnce) return;

    noHandTimer = global.setTimeout(function () {
      noHandTimerFired = true;
      if (revealed || handSeenOnce) return;
      showNoHandTip();
    }, cfg.hand.noHandHintMs || 10000);
  }

  function clearNoHandTimer() {
    if (noHandTimer) global.clearTimeout(noHandTimer);
    noHandTimer = 0;
  }

  function showNoHandTip() {
    showNote(NO_HAND_TIP, true, 'no-hand');
  }

  function markHandSeen() {
    if (handSeenOnce) return;
    handSeenOnce = true;
    clearNoHandTimer();
    // 如果提示条正好是“没检测到手”，检测到后立即收起
    if (
      dom.hintNote &&
      !dom.hintNote.hidden &&
      dom.hintNote.getAttribute('data-kind') === 'no-hand'
    ) {
      dom.hintNote.hidden = true;
    }
  }

  /* ---------------------------------------------------------------- 绽放 */

  function beginBloom(source) {
    if (revealed) return Promise.resolve();
    if (bloomPromise) return bloomPromise;

    setPhase('blooming');
    setCopy(COPY.blooming.prompt, COPY.blooming.sub);
    hideFallback();
    if (dom.hintNote) dom.hintNote.hidden = true;
    clearNoHandTimer();
    markHandSeen();

    if (dom.camState) dom.camState.textContent = 'SIGNAL';

    // 不再需要手势结果，立即停止送帧（摄像头流在 reveal 后关闭）
    if (ZRD.hands && ZRD.hands.stop) ZRD.hands.stop();

    var useParticles = ZRD.particles.isReady();

    if (useParticles) {
      ZRD.particles.setPhase('blooming');
      bloomPromise = ZRD.particles.bloom().catch(function (err) {
        console.error('[ZRD] 绽开动画异常', err);
        return false;
      });
    } else {
      bloomPromise = Promise.resolve(false);
    }

    return bloomPromise
      .then(function () {
        // 动画结束后留一点余韵，再淡入文案
        return new Promise(function (resolve) {
          global.setTimeout(resolve, useParticles ? 140 : 620);
        });
      })
      .then(function () {
        reveal();
        return true;
      });
  }

  function reveal() {
    if (revealed) return;
    revealed = true;
    setPhase('revealed');
    clearNoHandTimer();
    hideFallback();

    section.classList.add('is-bloomed');
    if (dom.reveal) {
      dom.reveal.hidden = false;
      // 强制一次样式计算，确保淡入从 opacity:0 开始（也避免后台标签页 rAF 不触发）
      void dom.reveal.offsetWidth;
      dom.reveal.classList.add('is-in');
    }

    if (dom.cam) dom.cam.classList.remove('is-live');
    if (dom.meta) dom.meta.textContent = 'CAM 01 · SIGNAL LOCKED';
    if (dom.hint) {
      dom.hint.setAttribute('aria-hidden', 'true');
      global.setTimeout(function () {
        if (revealed && dom.hint) dom.hint.hidden = true;
      }, 620);
    }

    // 评分出现后：不再响应手势，关闭摄像头
    global.setTimeout(function () {
      if (ZRD.hands && ZRD.hands.dispose) {
        try {
          ZRD.hands.dispose();
        } catch (err) {
          console.warn('[ZRD] 关闭摄像头失败', err);
        }
      }
    }, 600);

    ZRD.bus.emit('hero:reveal', { source: 'hand' });
  }

  /* ---------------------------------------------------------------- 兜底入口 */

  function bindFallback() {
    util.on(dom.fallback, 'click', function () {
      beginBloom('tap');
    });
  }

  function showFallback() {
    if (!dom.fallback || revealed) return;
    dom.fallback.hidden = false;
  }

  function hideFallback() {
    if (dom.fallback) dom.fallback.hidden = true;
  }

  /* ---------------------------------------------------------------- 评分 */

  function bindRating() {
    if (!dom.stars.length) return;

    dom.stars.forEach(function (star) {
      var value = parseInt(star.getAttribute('data-value'), 10);

      util.on(star, 'mouseenter', function () {
        paintStars(value);
        if (dom.ratingLabel) dom.ratingLabel.textContent = cfg.rating.labels[value - 1] || '';
      });

      util.on(star, 'focus', function () {
        // 未评分时只显示焦点框，不把焦点误当成“已选 5 星”
        if (!ratingValue) return;
        paintStars(ratingValue);
        renderRatingLabel();
      });

      util.on(star, 'click', function () {
        setRating(value);
      });
    });

    util.on(dom.rating, 'mouseleave', function () {
      paintStars(ratingValue);
      renderRatingLabel();
    });

    util.on(dom.rating, 'focusout', function (e) {
      if (dom.rating.contains(e.relatedTarget)) return;
      paintStars(ratingValue);
      renderRatingLabel();
    });

    util.on(dom.rating, 'keydown', function (e) {
      var idx = dom.stars.indexOf(document.activeElement);
      if (idx < 0) return;
      var next = idx;

      if (e.key === 'ArrowRight' || e.key === 'ArrowUp') next = Math.min(idx + 1, 4);
      else if (e.key === 'ArrowLeft' || e.key === 'ArrowDown') next = Math.max(idx - 1, 0);
      else if (e.key === 'Home') next = 0;
      else if (e.key === 'End') next = 4;
      else return;

      e.preventDefault();
      dom.stars[next].focus();
      setRating(next + 1);
    });
  }

  function loadRatings() {
    var data = ZRD.store.ratings.read();
    var summary = ZRD.store.ratings.summary(data);

    ratingValue = summary.last || 0;
    paintStars(ratingValue);
    renderRatingLabel();
    renderRatingSummary(summary);

    if (summary.count > 0) {
      if (dom.ratingSaved) {
        dom.ratingSaved.hidden = false;
        dom.ratingSaved.textContent = '已记录 · 仅存本机';
      }
      if (dom.ratingLast) {
        dom.ratingLast.hidden = false;
        dom.ratingLast.textContent =
          '你上次打了 ' + summary.last + ' 星，可以重新评分';
      }
    } else {
      if (dom.ratingSaved) dom.ratingSaved.hidden = true;
      if (dom.ratingLast) dom.ratingLast.hidden = true;
    }
  }

  function renderRatingSummary(summary) {
    if (dom.ratingAvg) {
      if (summary.count > 0) {
        dom.ratingAvg.textContent = '平均分 ' + summary.average.toFixed(1) + ' / 5';
        dom.ratingAvg.classList.add('is-rated');
      } else {
        dom.ratingAvg.textContent = '平均分 —';
        dom.ratingAvg.classList.remove('is-rated');
      }
    }
    if (dom.ratingCount) {
      dom.ratingCount.textContent = summary.count + ' 次评分';
    }
  }

  function setRating(value) {
    var score = util.clamp(Math.round(value), 1, 5);
    var result = ZRD.store.ratings.add(score);
    var summary = ZRD.store.ratings.summary(result.data);

    ratingValue = summary.last || score;
    paintStars(ratingValue);
    renderRatingLabel();
    renderRatingSummary(summary);

    if (dom.ratingSaved) {
      dom.ratingSaved.hidden = false;
      dom.ratingSaved.textContent = result.stored
        ? '已记录 · 仅存本机'
        : '仅本次会话 · 存储不可用';
    }
    if (dom.ratingLast) {
      dom.ratingLast.hidden = false;
      dom.ratingLast.textContent = result.stored
        ? '已记录 ' + score + ' 星 · 平均分已更新'
        : '本次评分仅本会话有效 · 存储被禁用';
    }

    ZRD.bus.emit('rating:change', { value: ratingValue, summary: summary });
  }

  function paintStars(value) {
    dom.stars.forEach(function (star, i) {
      var on = i < value;
      star.classList.toggle('is-on', on);
      star.setAttribute('aria-checked', i === value - 1 ? 'true' : 'false');
      star.tabIndex = value ? (i === value - 1 ? 0 : -1) : i === 4 ? 0 : -1;
    });
  }

  function renderRatingLabel() {
    if (!dom.ratingLabel) return;
    dom.ratingLabel.textContent = ratingValue
      ? ratingValue + ' / 5 · ' + (cfg.rating.labels[ratingValue - 1] || '')
      : '未评分';
  }

  /* ---------------------------------------------------------------- 工具 */

  function setPhase(next) {
    phase = next;
    util.log('hero.phase →', next);
  }

  function setCopy(prompt, sub) {
    if (dom.prompt && prompt) dom.prompt.textContent = prompt;
    if (dom.sub && sub) dom.sub.textContent = sub;
  }

  function showNote(text, persist, kind) {
    if (!dom.hintNote) return;
    global.clearTimeout(noteTimer);
    dom.hintNote.textContent = text;
    dom.hintNote.setAttribute('data-kind', kind || 'info');
    dom.hintNote.hidden = false;

    if (!persist) {
      noteTimer = global.setTimeout(function () {
        dom.hintNote.hidden = true;
      }, 5200);
    }
  }

  ZRD.hero = {
    init: init,
    beginBloom: beginBloom,
    reveal: reveal,
    get phase() {
      return phase;
    }
  };
})(window);
