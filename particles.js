/* ============================================================================
   particles.js —— A 模块：Three.js 粒子花苞 → 绽开
   ----------------------------------------------------------------------------
   实现要点：
     - THREE.Points + 自定义 ShaderMaterial（AdditiveBlending），3000~5000 粒子
     - 每个粒子有：当前坐标 / 当前速度 / 花苞目标 / 绽开目标
     - 花苞：紧致椭球，冷色、低亮度、轻微呼吸
     - 绽开：随机球面外推目标 + 阻尼弹簧逼近 + 缓出；冷色 → 暖色；2.8s
     - 绽开后：缓慢漂浮，忽略手势输入
   ========================================================================== */

(function (global) {
  'use strict';

  var ZRD = global.ZRD;
  var cfg = ZRD.config.particle;
  var util = ZRD.util;
  var BUD_OFFSET = 0.55; // 花苞视觉中心略高于画面中心，给下方文案让位

  var VERTEX_SHADER = [
    'uniform float uTime;',
    'uniform float uPixelRatio;',
    'uniform float uWarmth;',
    'uniform float uDrift;',
    'uniform float uBreath;',
    'attribute float aSize;',
    'attribute float aSeed;',
    'attribute float aTint;',
    'varying vec3 vColor;',
    'varying float vAlpha;',
    '',
    'void main() {',
    '  vec3 p = position * uBreath;',
    // 缓慢漂浮：每颗粒子有独立相位，避免整体同步
    '  p.x += sin(uTime * 0.32 + aSeed * 6.2831) * uDrift;',
    '  p.y += cos(uTime * 0.27 + aSeed * 6.2831) * uDrift;',
    '  p.z += sin(uTime * 0.23 + aSeed * 3.1416) * uDrift * 0.7;',
    '',
    '  vec4 mv = modelViewMatrix * vec4(p, 1.0);',
    '  gl_Position = projectionMatrix * mv;',
    '',
    '  float twinkle = 0.72 + 0.28 * sin(uTime * 1.7 + aSeed * 15.0);',
    '  gl_PointSize = clamp(aSize * uPixelRatio * (26.0 / max(0.05, -mv.z)) * twinkle, 1.0, 42.0);',
    '',
    // 冷：深青蓝 → 冷青；暖：余烬橙 → 金色
    '  vec3 cold = mix(vec3(0.045, 0.13, 0.16), vec3(0.17, 0.48, 0.54), aTint);',
    '  vec3 warm = mix(vec3(1.00, 0.28, 0.08), vec3(1.00, 0.72, 0.36), aTint);',
    '  float warmMix = clamp(uWarmth * 1.25 - aTint * 0.22, 0.0, 1.0);',
    '  vColor = mix(cold, warm, warmMix);',
    '  vAlpha = mix(0.25, 0.92, uWarmth) * twinkle;',
    '}'
  ].join('\n');

  var FRAGMENT_SHADER = [
    'varying vec3 vColor;',
    'varying float vAlpha;',
    '',
    'void main() {',
    '  vec2 uv = gl_PointCoord - vec2(0.5);',
    '  float d = length(uv);',
    '  if (d > 0.5) discard;',
    '  float core = smoothstep(0.5, 0.0, d);',
    '  float alpha = pow(core, 1.8) * vAlpha;',
    '  vec3 col = vColor * (0.55 + core * 1.9);',
    '  gl_FragColor = vec4(col, alpha);',
    '}'
  ].join('\n');

  /* ---------------------------------------------------------------- 状态 */

  var canvasEl = null;
  var renderer = null;
  var scene = null;
  var camera = null;
  var points = null;
  var geometry = null;
  var material = null;

  var count = 0;
  var posArr = null;
  var velArr = null;
  var budArr = null;
  var bloomArr = null;
  var bloomDir = null;
  var bloomFrac = null;
  var seedArr = null;
  var sizeArr = null;
  var tintArr = null;
  var posAttr = null;

  var phase = 'idle'; // idle | bud | blooming | bloomed
  var bloomPromise = null;
  var bloomResolvers = [];
  var bloomStartedAt = 0;
  var bloomDuration = cfg.bloomDuration;
  var bloomEnded = false;
  var bloomProgress = 0;
  var targetRadius = 1.6;

  var rafId = 0;
  var lastTs = 0;
  var paused = false;
  var reduced = util.prefersReducedMotion();

  var hint = { x: 0, y: 0, active: false };

  function isReady() {
    return !!(renderer && scene && points && camera);
  }

  /* ---------------------------------------------------------------- 几何 */

  function computeBloomRadius() {
    // 视口短边换算到 camera.position.z 所在平面，绽开直径约占短边的 bloomCoverage
    var vFov = (camera.fov * Math.PI) / 180;
    var visibleHeight = 2 * Math.tan(vFov / 2) * camera.position.z;
    var visibleWidth = visibleHeight * camera.aspect;
    return (Math.min(visibleWidth, visibleHeight) * cfg.bloomCoverage) / 2;
  }

  /** 花苞：紧致椭球；同时预生成绽开方向与半径系数 */
  function buildParticleData() {
    var n = count;
    posArr = new Float32Array(n * 3);
    velArr = new Float32Array(n * 3);
    budArr = new Float32Array(n * 3);
    bloomArr = new Float32Array(n * 3);
    bloomDir = new Float32Array(n * 3);
    bloomFrac = new Float32Array(n);
    seedArr = new Float32Array(n);
    sizeArr = new Float32Array(n);
    tintArr = new Float32Array(n);

    for (var i = 0; i < n; i++) {
      var i3 = i * 3;
      var seed = Math.random();
      seedArr[i] = seed;
      tintArr[i] = Math.random();
      // 尺寸带一点极端值，让光点有主次
      sizeArr[i] = Math.random() < 0.08 ? util.rand(2.2, 3.0) : util.rand(0.65, 1.9);

      // —— 花苞目标：略扁的椭球，中心更密 ——
      var u1 = Math.random() * 2 - 1;
      var th1 = Math.random() * Math.PI * 2;
      var s1 = Math.sqrt(Math.max(0, 1 - u1 * u1));
      var r1 = 0.25 + 0.15 * Math.pow(Math.random(), 1.6);
      var bx = r1 * s1 * Math.cos(th1);
      var by = r1 * u1 * 1.22;
      var bz = r1 * s1 * Math.sin(th1) * 0.9;
      if (i % 11 === 0) {
        // 花心：极少量粒子收得更紧，形成亮核
        bx *= 0.32;
        by *= 0.32;
        bz *= 0.32;
      }

      budArr[i3] = bx;
      budArr[i3 + 1] = by;
      budArr[i3 + 2] = bz;

      posArr[i3] = bx;
      posArr[i3 + 1] = by;
      posArr[i3 + 2] = bz;

      // —— 绽开方向：随机球面 + 轻微压扁（更像花冠，不像实心球） ——
      var u2 = Math.random() * 2 - 1;
      var th2 = Math.random() * Math.PI * 2;
      var s2 = Math.sqrt(Math.max(0, 1 - u2 * u2));
      var dx = s2 * Math.cos(th2);
      var dy = u2 * 0.92;
      var dz = s2 * Math.sin(th2) * 0.72;
      var len = Math.sqrt(dx * dx + dy * dy + dz * dz) || 1;
      bloomDir[i3] = dx / len;
      bloomDir[i3 + 1] = dy / len;
      bloomDir[i3 + 2] = dz / len;

      // 半径分布偏向球壳，保留少量内部粒子
      var frac = 0.40 + 0.60 * Math.pow(Math.random(), 0.42);
      if (i % 9 === 0) frac *= 0.28;
      bloomFrac[i] = frac;
    }
  }

  function prepareBloomTargets() {
    var R = targetRadius || computeBloomRadius();
    for (var i = 0; i < count; i++) {
      var i3 = i * 3;
      var r = R * bloomFrac[i];
      bloomArr[i3] = bloomDir[i3] * r;
      bloomArr[i3 + 1] = bloomDir[i3 + 1] * r;
      bloomArr[i3 + 2] = bloomDir[i3 + 2] * r;
    }
  }

  /* ---------------------------------------------------------------- 初始化 */

  function init(canvas) {
    if (!canvas || !global.THREE) return false;
    if (renderer) return true;

    canvasEl = canvas;
    count = util.isMobile() ? cfg.countMobile : cfg.count;

    try {
      renderer = new global.THREE.WebGLRenderer({
        canvas: canvas,
        alpha: true,
        antialias: false,
        powerPreference: 'high-performance'
      });
      renderer.setPixelRatio(Math.min(global.devicePixelRatio || 1, cfg.dprCap));
      renderer.setClearColor(0x000000, 0);

      scene = new global.THREE.Scene();
      camera = new global.THREE.PerspectiveCamera(45, 1, 0.1, 100);
      camera.position.set(0, 0, 6);
      targetRadius = computeBloomRadius();

      buildParticleData();

      geometry = new global.THREE.BufferGeometry();
      posAttr = new global.THREE.BufferAttribute(posArr, 3);
      if (global.THREE.DynamicDrawUsage) posAttr.setUsage(global.THREE.DynamicDrawUsage);
      geometry.setAttribute('position', posAttr);
      geometry.setAttribute('aSize', new global.THREE.BufferAttribute(sizeArr, 1));
      geometry.setAttribute('aSeed', new global.THREE.BufferAttribute(seedArr, 1));
      geometry.setAttribute('aTint', new global.THREE.BufferAttribute(tintArr, 1));

      material = new global.THREE.ShaderMaterial({
        uniforms: {
          uTime: { value: 0 },
          uPixelRatio: { value: renderer.getPixelRatio() },
          uWarmth: { value: 0 },
          uDrift: { value: cfg.driftIdle },
          uBreath: { value: 1 }
        },
        vertexShader: VERTEX_SHADER,
        fragmentShader: FRAGMENT_SHADER,
        transparent: true,
        blending: global.THREE.AdditiveBlending,
        depthWrite: false,
        depthTest: false
      });

      points = new global.THREE.Points(geometry, material);
      points.frustumCulled = false;
      points.renderOrder = 2;
      points.position.y = BUD_OFFSET;
      scene.add(points);

      canvas.addEventListener('webglcontextlost', onContextLost, false);

      resize();
      phase = 'bud';
      startLoop();

      util.log('particles ready', { count: count, radius: targetRadius.toFixed(2) });
      return true;
    } catch (err) {
      console.error('[ZRD] 粒子初始化失败', err);
      disposePartial();
      return false;
    }
  }

  function disposePartial() {
    try {
      if (geometry) geometry.dispose();
      if (material) material.dispose();
      if (renderer) renderer.dispose();
    } catch (e) {
      /* 忽略 */
    }
    geometry = null;
    material = null;
    renderer = null;
    points = null;
  }

  /* ---------------------------------------------------------------- 绽开 */

  function bloom() {
    if (!isReady()) return Promise.resolve(false);
    if (phase === 'bloomed') return Promise.resolve(true);
    if (bloomPromise) return bloomPromise;

    phase = 'blooming';
    bloomEnded = false;
    bloomDuration = reduced ? 1.2 : cfg.bloomDuration;
    bloomStartedAt = util.now();
    hint.active = false;
    prepareBloomTargets();

    bloomPromise = new Promise(function (resolve) {
      bloomResolvers.push(resolve);
    });

    util.log('particles bloom start', { duration: bloomDuration, radius: targetRadius.toFixed(2) });
    return bloomPromise;
  }

  function finishBloom() {
    if (bloomEnded) return;
    bloomEnded = true;
    phase = 'bloomed';
    bloomProgress = 1;
    hint.active = false;

    if (material) {
      material.uniforms.uWarmth.value = 1;
      material.uniforms.uDrift.value = cfg.driftBloom;
    }

    var resolvers = bloomResolvers.splice(0);
    resolvers.forEach(function (fn) {
      try {
        fn(true);
      } catch (e) {
        console.error(e);
      }
    });

    ZRD.bus.emit('particle:bloom-end', {});
  }

  function setPhase(next) {
    if (next === 'blooming') {
      bloom();
      return;
    }
    if (next === 'bloomed') {
      finishBloom();
      return;
    }
    if (phase === next) return;
    phase = next;
    if (next === 'bud') hint.active = false;
  }

  /* ---------------------------------------------------------------- 循环 */

  function startLoop() {
    if (rafId) return;
    lastTs = util.now();
    rafId = global.requestAnimationFrame(loop);
  }

  function loop(ts) {
    rafId = global.requestAnimationFrame(loop);

    if (paused || !renderer || !scene || !camera) {
      lastTs = ts;
      return;
    }

    var dt = Math.min((ts - lastTs) / 1000, 0.05);
    lastTs = ts;
    var now = util.now();
    var elapsed = (now - bloomStartedAt) / 1000;

    if (phase === 'blooming') {
      var t = util.clamp(elapsed / bloomDuration, 0, 1);
      bloomProgress = util.easeOutCubic(t);
      // 扩散用缓出；颜色用 smoothstep，让冷色多停留一会儿，再整体转暖
      material.uniforms.uWarmth.value = t * t * (3 - 2 * t);
      material.uniforms.uDrift.value = util.lerp(cfg.driftIdle, cfg.driftBloom, bloomProgress);
      if (t >= 1) finishBloom();
    } else if (phase === 'bloomed') {
      bloomProgress = 1;
    }

    updateCamera(dt);
    updateParticles(dt, elapsed);

    material.uniforms.uTime.value = now * 0.001;
    material.uniforms.uBreath.value = 1 + Math.sin(now * 0.0009) * 0.022;

    // 花苞略高；绽开时下沉回中心，形成“从花苞位置向四周铺开”的势能
    if (points) points.position.y = BUD_OFFSET * (1 - bloomProgress);

    if (phase === 'bloomed' && points) {
      points.rotation.y += dt * 0.028;
      points.rotation.x = Math.sin(now * 0.00012) * 0.05;
    }

    if (posAttr) posAttr.needsUpdate = true;
    renderer.render(scene, camera);
  }

  /** 弹簧 + 阻尼：向“当前目标”逼近；绽开目标本身按 easeOutCubic 推进 */
  function updateParticles(dt, elapsed) {
    var spring;
    var damping;

    if (phase === 'blooming') {
      spring = 14;
      damping = Math.pow(0.86, dt * 60);
    } else if (phase === 'bloomed') {
      spring = 4.5;
      damping = Math.pow(0.90, dt * 60);
    } else {
      spring = 7;
      damping = Math.pow(0.90, dt * 60);
    }

    var blooming = phase === 'blooming';
    var bloomed = phase === 'bloomed';
    var denom = Math.max(0.3, bloomDuration - 0.35);

    for (var i = 0; i < count; i++) {
      var i3 = i * 3;
      var tx;
      var ty;
      var tz;

      if (blooming || bloomed) {
        var local = 1;
        if (blooming) {
          var delay = seedArr[i] * 0.35; // 后面的粒子晚一点出发，形成层次
          local = util.clamp((elapsed - delay) / denom, 0, 1);
        }
        var e = util.easeOutCubic(local);
        tx = budArr[i3] + (bloomArr[i3] - budArr[i3]) * e;
        ty = budArr[i3 + 1] + (bloomArr[i3 + 1] - budArr[i3 + 1]) * e;
        tz = budArr[i3 + 2] + (bloomArr[i3 + 2] - budArr[i3 + 2]) * e;
      } else {
        tx = budArr[i3];
        ty = budArr[i3 + 1];
        tz = budArr[i3 + 2];
      }

      var ax = (tx - posArr[i3]) * spring;
      var ay = (ty - posArr[i3 + 1]) * spring;
      var az = (tz - posArr[i3 + 2]) * spring;

      velArr[i3] = (velArr[i3] + ax * dt) * damping;
      velArr[i3 + 1] = (velArr[i3 + 1] + ay * dt) * damping;
      velArr[i3 + 2] = (velArr[i3 + 2] + az * dt) * damping;

      posArr[i3] += velArr[i3] * dt;
      posArr[i3 + 1] += velArr[i3 + 1] * dt;
      posArr[i3 + 2] += velArr[i3 + 2] * dt;
    }
  }

  function updateCamera(dt) {
    var tx = phase === 'bud' && hint.active ? hint.x * 0.09 : 0;
    var ty = phase === 'bud' && hint.active ? hint.y * 0.07 : 0;
    var k = Math.min(1, dt * 2.5);
    camera.position.x += (tx - camera.position.x) * k;
    camera.position.y += (ty - camera.position.y) * k;
    camera.lookAt(0, 0, 0);
  }

  /* ---------------------------------------------------------------- 尺寸 */

  function resize() {
    if (!renderer || !camera || !canvasEl) return;

    var parent = canvasEl.parentElement;
    var w = canvasEl.clientWidth || (parent ? parent.clientWidth : 0) || global.innerWidth;
    var h = canvasEl.clientHeight || (parent ? parent.clientHeight : 0) || global.innerHeight;
    w = Math.max(1, Math.round(w));
    h = Math.max(1, Math.round(h));

    renderer.setSize(w, h, false);
    camera.aspect = w / h;
    camera.updateProjectionMatrix();
    material.uniforms.uPixelRatio.value = renderer.getPixelRatio();

    targetRadius = computeBloomRadius();
  }

  /* ---------------------------------------------------------------- 输入 */

  function setHint(x, y, pinch) {
    // 只处理花苞阶段的轻微视差；绽开后不再响应手势
    if (phase !== 'bud') return;
    hint.x = util.clamp(x || 0, -1, 1);
    hint.y = util.clamp(y || 0, -1, 1);
    hint.active = true;
    void pinch;
  }

  function setPaused(value) {
    var next = !!value;
    if (next === paused) return;
    paused = next;

    if (paused) {
      // 真正停掉 RAF，第 2 屏 / 结算层打开后不再占用渲染帧
      if (rafId) global.cancelAnimationFrame(rafId);
      rafId = 0;
    } else {
      lastTs = util.now();
      if (isReady()) startLoop();
    }
  }

  /* ---------------------------------------------------------------- 清理 */

  function onContextLost(event) {
    event.preventDefault();
    paused = true;
    if (rafId) global.cancelAnimationFrame(rafId);
    rafId = 0;
    ZRD.bus.emit('particles:error', { message: 'WebGL 上下文丢失' });
  }

  function dispose() {
    if (rafId) global.cancelAnimationFrame(rafId);
    rafId = 0;

    if (canvasEl) canvasEl.removeEventListener('webglcontextlost', onContextLost, false);
    if (geometry) geometry.dispose();
    if (material) material.dispose();
    if (renderer) renderer.dispose();

    renderer = null;
    scene = null;
    camera = null;
    points = null;
    geometry = null;
    material = null;
    posAttr = null;
    bloomPromise = null;
    bloomResolvers = [];
    phase = 'idle';
  }

  /** 仅调试用：跳过动画，直接把粒子放到绽开终态 */
  function debugBloom() {
    if (!isReady()) return false;
    prepareBloomTargets();
    for (var i = 0; i < count; i++) {
      var i3 = i * 3;
      posArr[i3] = bloomArr[i3];
      posArr[i3 + 1] = bloomArr[i3 + 1];
      posArr[i3 + 2] = bloomArr[i3 + 2];
      velArr[i3] = 0;
      velArr[i3 + 1] = 0;
      velArr[i3 + 2] = 0;
    }
    phase = 'bloomed';
    bloomProgress = 1;
    if (points) points.position.y = 0;
    material.uniforms.uWarmth.value = 1;
    material.uniforms.uDrift.value = cfg.driftBloom;
    if (posAttr) posAttr.needsUpdate = true;
    renderer.render(scene, camera);
    return true;
  }

  ZRD.particles = {
    init: init,
    setPhase: setPhase,
    bloom: bloom,
    setHint: setHint,
    resize: resize,
    setPaused: setPaused,
    dispose: dispose,
    debugBloom: debugBloom,
    isReady: isReady,
    get phase() {
      return phase;
    },
    get progress() {
      return bloomProgress;
    },
    get count() {
      return count;
    },
    get paused() {
      return paused;
    }
  };
})(window);
