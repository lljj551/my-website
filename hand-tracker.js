/* ============================================================================
   hand-tracker.js —— 手势识别（MediaPipe Hands + getUserMedia）
   ----------------------------------------------------------------------------
   规则（严格按需求实现，不使用手指夹角）：
     1) 只取一只手
     2) 用手腕 → 中指 MCP 的距离做尺度归一化
     3) 食指/中指/无名指/小指：指尖到手腕距离 / PIP 到手腕距离 > 1.5
     4) 四指同时满足，连续保持 500ms 才触发一次 hand:open

   事件：
     hand:status  { phase, message }
     hand:track   { present, score, ratios, holdMs, holdTarget }
     hand:open    { score, ratios, heldMs }
     hand:error   { code, message }
   ========================================================================== */

(function (global) {
  'use strict';

  var ZRD = global.ZRD;
  var cfg = ZRD.config.hand;
  var util = ZRD.util;

  var video = null;
  var stream = null;
  var hands = null;
  var state = 'idle';
  var errCode = null;
  var initPromise = null;

  var running = false;
  var rafId = 0;
  var lastSendAt = 0;
  var sending = false;
  var sendErrors = 0;

  var openScore = 0;
  var ratios = [0, 0, 0, 0];
  var holdStart = 0;
  var fired = false;
  var lastPresent = false;
  var lastResultAt = 0;
  var lastTrackAt = 0;
  var lastNoHandAt = 0;
  var disposed = false;

  function log() {
    util.log.apply(null, arguments);
  }

  function setState(next, message) {
    state = next;
    ZRD.bus.emit('hand:status', { phase: next, message: message || '' });
  }

  function fail(code, message) {
    errCode = code;
    setState(
      code === 'insecure' ? 'insecure' : code === 'denied' ? 'denied' : 'error',
      message
    );
    ZRD.bus.emit('hand:error', { code: code, message: message });
    return false;
  }

  function requestCamera() {
    var constraints = {
      video: {
        width: { ideal: 640 },
        height: { ideal: 480 },
        facingMode: 'user',
        frameRate: { ideal: 30, max: 30 }
      },
      audio: false
    };

    return global.navigator.mediaDevices.getUserMedia(constraints).catch(function (err) {
      if (err && err.name === 'OverconstrainedError') {
        // 某些摄像头不支持 640×480 / 30fps，退回最简单约束
        return global.navigator.mediaDevices.getUserMedia({ video: true, audio: false });
      }
      throw err;
    });
  }

  function attachStream(s) {
    if (disposed) {
      stopStream(s);
      throw new Error('摄像头已关闭');
    }
    stream = s;
    video.srcObject = s;
    video.muted = true;
    video.setAttribute('playsinline', '');

    var p = video.play();
    return p && p.catch ? p.catch(function () {}) : Promise.resolve();
  }

  function stopStream(s) {
    var target = s || stream;
    if (!target || !target.getTracks) return;
    target.getTracks().forEach(function (track) {
      try {
        track.stop();
      } catch (e) {
        /* 忽略 */
      }
    });
  }

  /**
   * 加载 MediaPipe Hands。
   * 注意：wasm / 模型来自同一 CDN，file:// 下会被浏览器拦截。
   */
  function createModel() {
    setState('initializing', '正在加载手势模型');

    return new Promise(function (resolve, reject) {
      try {
        if (!global.Hands) {
          reject(new Error('MediaPipe Hands 未加载'));
          return;
        }

        hands = new global.Hands({
          locateFile: function (file) {
            return cfg.cdnBase + file;
          }
        });

        hands.setOptions({
          maxNumHands: 1,
          modelComplexity: 1,
          minDetectionConfidence: cfg.minDetectionConfidence,
          minTrackingConfidence: cfg.minTrackingConfidence
        });

        hands.onResults(onResults);

        // 旧版本可能没有 initialize()，此时由第一次 send 触发加载
        var ready =
          typeof hands.initialize === 'function' ? hands.initialize() : Promise.resolve();

        Promise.resolve(ready).then(resolve, reject);
      } catch (err) {
        reject(err);
      }
    });
  }

  /* ---------------------------------------------------------------- 对外初始化 */

  function init(videoEl) {
    if (state === 'ready' || state === 'tracking') return Promise.resolve(true);
    if (initPromise) return initPromise;

    video = videoEl || video;
    if (!video) return Promise.resolve(fail('no-video', '找不到 video 元素'));
    disposed = false;
    if (util.isFileProtocol()) {
      return Promise.resolve(
        fail('insecure', 'file:// 无法访问摄像头，请用本地 HTTP 服务打开')
      );
    }
    if (!global.navigator.mediaDevices || !global.navigator.mediaDevices.getUserMedia) {
      return Promise.resolve(fail('unsupported', '当前浏览器不支持摄像头采集'));
    }
    if (!global.Hands) {
      return Promise.resolve(fail('no-model', 'MediaPipe Hands 未加载（检查 CDN / 网络）'));
    }

    setState('loading', '正在请求摄像头权限');

    initPromise = requestCamera()
      .then(attachStream)
      .then(createModel)
      .then(function () {
        if (disposed) {
          stopStream();
          return false;
        }
        setState('ready', '摄像头就绪');
        log('hand tracker ready');
        return true;
      })
      .catch(function (err) {
        var name = err && err.name;
        if (name === 'NotAllowedError' || name === 'SecurityError') {
          return fail('denied', '摄像头权限被拒绝，可在地址栏重新授权');
        }
        if (name === 'NotFoundError') {
          return fail('no-camera', '未检测到可用摄像头');
        }
        if (name === 'OverconstrainedError') {
          return fail('no-camera', '摄像头不支持所需分辨率');
        }
        if (name === 'NotReadableError' || name === 'AbortError') {
          return fail('busy', '摄像头被其他程序占用');
        }
        console.error('[ZRD] 手势初始化失败', err);
        if (String(err && err.message).indexOf('MediaPipe') > -1) {
          return fail('no-model', '手势模型加载失败（检查 CDN / 网络）');
        }
        return fail('error', '摄像头初始化失败：' + (err && err.message ? err.message : '未知错误'));
      });

    return initPromise;
  }

  /* ---------------------------------------------------------------- 送帧 */

  function start() {
    if (running || !hands) return;
    // ready / tracking / no-hand 都可能需要恢复送帧（例如切回标签页）
    if (state !== 'ready' && state !== 'tracking' && state !== 'no-hand') return;
    running = true;
    lastSendAt = 0;
    lastResultAt = util.now();
    rafId = global.requestAnimationFrame(pump);
    log('hand tracker started');
  }

  function stop() {
    running = false;
    if (rafId) global.cancelAnimationFrame(rafId);
    rafId = 0;
    sending = false;
    holdStart = 0;
  }

  function pump(ts) {
    if (!running) return;
    rafId = global.requestAnimationFrame(pump);

    if (!hands || !video || video.readyState < 2 || sending) return;
    if (ts - lastSendAt < cfg.sendIntervalMs) return;

    lastSendAt = ts;
    sending = true;

    var result;
    try {
      result = hands.send({ image: video });
    } catch (err) {
      sending = false;
      noteSendError(err);
      return;
    }

    Promise.resolve(result)
      .catch(function (err) {
        noteSendError(err);
      })
      .then(function () {
        sending = false;
      });
  }

  function noteSendError(err) {
    sendErrors += 1;
    if (sendErrors <= 3) console.warn('[ZRD] hands.send 失败', err);
    if (sendErrors === 5 && !fired) {
      // 连续失败通常意味着 wasm / 模型没有加载成功
      ZRD.bus.emit('hand:error', {
        code: 'send-failed',
        message: '手势模型运行异常'
      });
    }
  }

  /* ---------------------------------------------------------------- 结果 */

  function onResults(results) {
    try {
      var lm = results && results.multiHandLandmarks && results.multiHandLandmarks[0];
      if (!lm) {
        handleNoHand();
        return;
      }
      handleHand(lm);
    } catch (err) {
      console.warn('[ZRD] 手势结果处理异常', err);
    }
  }

  function handleNoHand() {
    var now = util.now();
    lastResultAt = now;
    openScore = 0;
    ratios = [0, 0, 0, 0];
    holdStart = 0;

    if (lastPresent) {
      lastPresent = false;
      setState('no-hand', '未检测到手');
    } else if (now - lastNoHandAt > 600) {
      lastNoHandAt = now;
      setState('no-hand', '未检测到手');
    }

    if (now - lastTrackAt > 100) {
      lastTrackAt = now;
      ZRD.bus.emit('hand:track', {
        present: false,
        score: 0,
        ratios: [0, 0, 0, 0],
        holdMs: 0,
        holdTarget: cfg.openPalmHoldMs
      });
    }
  }

  function handleHand(lm) {
    var now = util.now();
    var previous = lastResultAt;
    lastResultAt = now;

    // 结果流中断过久：不把中断前的时间算进 500ms
    if (previous && now - previous > 400) holdStart = 0;

    var metrics = analyze(lm);
    openScore = metrics.score;
    ratios = metrics.ratios;

    if (!lastPresent) {
      lastPresent = true;
      setState('tracking', '已检测到手');
    }

    var holdMs = holdStart ? now - holdStart : 0;

    if (!fired) {
      if (metrics.open) {
        if (!holdStart) holdStart = now;
        holdMs = now - holdStart;

        if (holdMs >= cfg.openPalmHoldMs) {
          fired = true;
          holdMs = cfg.openPalmHoldMs;
          log('open palm detected', metrics.ratios);
          ZRD.bus.emit('hand:open', {
            score: openScore,
            ratios: metrics.ratios.slice(),
            heldMs: holdMs
          });
        }
      } else {
        holdStart = 0;
        holdMs = 0;
      }
    }

    if (now - lastTrackAt >= 90) {
      lastTrackAt = now;
      ZRD.bus.emit('hand:track', {
        present: true,
        score: openScore,
        ratios: metrics.ratios.slice(),
        holdMs: holdMs,
        holdTarget: cfg.openPalmHoldMs
      });
    }

    // 花苞阶段给粒子一点视差；绽开后 particles 会自行忽略
    if (ZRD.particles && ZRD.particles.setHint) {
      var palm = palmCenter(lm);
      ZRD.particles.setHint((0.5 - palm.x) * 2, (0.5 - palm.y) * 2, openScore);
    }
  }

  /**
   * 计算开掌度：
   *   - x 按视频宽高比校正，消除非等比缩放
   *   - 全部距离除以“手腕 → 中指 MCP”的基准尺度
   *   - 四指伸展比 = 指尖到腕距离 / PIP 到腕距离
   */
  function analyze(lm) {
    var videoW = (video && video.videoWidth) || 640;
    var videoH = (video && video.videoHeight) || 480;
    var aspect = videoW / videoH;

    var wrist = { x: lm[0].x * aspect, y: lm[0].y };
    var middleMcp = { x: lm[9].x * aspect, y: lm[9].y };
    var scale =
      Math.hypot(middleMcp.x - wrist.x, middleMcp.y - wrist.y) || 1e-6;

    function norm(i) {
      return {
        x: ((lm[i].x * aspect) - wrist.x) / scale,
        y: (lm[i].y - wrist.y) / scale
      };
    }

    // 食指 / 中指 / 无名指 / 小指：[tip, pip]
    var pairs = [
      [8, 6],
      [12, 10],
      [16, 14],
      [20, 18]
    ];

    var out = [];
    for (var i = 0; i < pairs.length; i++) {
      var tip = norm(pairs[i][0]);
      var pip = norm(pairs[i][1]);
      var dTip = Math.hypot(tip.x, tip.y);
      var dPip = Math.hypot(pip.x, pip.y);
      out.push(dTip / Math.max(dPip, 1e-6));
    }

    var minRatio = Math.min.apply(null, out);
    var open = out.every(function (r) {
      return r > cfg.openPalmThreshold;
    });

    // 0~1 的置信度，仅用于 UI 反馈；触发仍以四指全部 > 1.5 为准
    var score = util.clamp((minRatio - 1.1) / 0.65, 0, 1);

    return { open: open, ratios: out, score: score, minRatio: minRatio };
  }

  function palmCenter(lm) {
    var idx = [0, 5, 9, 13, 17];
    var x = 0;
    var y = 0;
    for (var i = 0; i < idx.length; i++) {
      x += lm[idx[i]].x;
      y += lm[idx[i]].y;
    }
    return { x: x / idx.length, y: y / idx.length };
  }

  /* ---------------------------------------------------------------- 清理 */

  function releaseLock() {
    fired = false;
    holdStart = 0;
    openScore = 0;
  }

  function dispose() {
    stop();
    disposed = true;
    try {
      if (hands && typeof hands.close === 'function') hands.close();
    } catch (err) {
      /* 忽略 */
    }
    stopStream();
    if (video) video.srcObject = null;

    hands = null;
    stream = null;
    lastPresent = false;
    fired = false;
    holdStart = 0;
    openScore = 0;
    initPromise = null;
    errCode = null;
    setState('idle', '摄像头已关闭');
  }

  ZRD.hands = {
    init: init,
    start: start,
    stop: stop,
    dispose: dispose,
    releaseLock: releaseLock,
    get state() {
      return state;
    },
    get errorCode() {
      return errCode;
    },
    get openScore() {
      return openScore;
    },
    get ratios() {
      return ratios.slice();
    }
  };
})(window);
