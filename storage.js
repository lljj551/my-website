/* ============================================================================
   storage.js —— localStorage 封装（唯一持久化通道，不接后端）
   约定：业务键集中在 ZRD.config.keys；评分使用 zrd_ratings
   容错：隐私模式 / 配额满 / 被禁用时降级为内存，页面不抛错、不白屏
   ========================================================================== */

(function (global) {
  'use strict';

  var ZRD = global.ZRD;
  var RATINGS_KEY = ZRD.config.keys.ratings;
  var memory = Object.create(null);
  var ratingMemory = null;
  var usable = (function () {
    try {
      var k = '__zrd_probe__';
      global.localStorage.setItem(k, '1');
      global.localStorage.removeItem(k);
      return true;
    } catch (e) {
      return false;
    }
  })();

  /* ---------------------------------------------------------------- 基础读写 */

  function raw(key) {
    try {
      return usable ? global.localStorage.getItem(key) : (key in memory ? memory[key] : null);
    } catch (e) {
      return key in memory ? memory[key] : null;
    }
  }

  function write(key, value) {
    memory[key] = value;
    if (!usable) return false;
    try {
      global.localStorage.setItem(key, value);
      return true;
    } catch (e) {
      ZRD.util.log('localStorage 写入失败，已退回内存:', e && e.message);
      return false;
    }
  }

  function drop(key) {
    delete memory[key];
    if (key === RATINGS_KEY) ratingMemory = null;
    if (!usable) return;
    try {
      global.localStorage.removeItem(key);
    } catch (e) {
      /* 忽略 */
    }
  }

  /* ---------------------------------------------------------------- 评分数据
     localStorage["zrd_ratings"] =
       JSON.stringify({ scores: [5, 3, 4], lastUpdated: "2025-..." })
     每次点击 append 一条；读取时做结构校验，坏数据不炸页面。
     ------------------------------------------------------------------ */

  function emptyRatings() {
    return { scores: [], lastUpdated: null };
  }

  function cloneRatings(data) {
    return {
      scores: data.scores.slice(),
      lastUpdated: data.lastUpdated || null
    };
  }

  function sanitizeScores(list) {
    if (!Array.isArray(list)) return [];
    var out = [];
    for (var i = 0; i < list.length; i++) {
      var n = Math.round(Number(list[i]));
      if (isFinite(n) && n >= 1 && n <= 5) out.push(n);
    }
    return out;
  }

  function readRatings() {
    try {
      var rawValue = global.localStorage.getItem(RATINGS_KEY);
      if (rawValue == null) {
        return ratingMemory ? cloneRatings(ratingMemory) : emptyRatings();
      }
      var parsed = JSON.parse(rawValue);
      var data = {
        scores: sanitizeScores(parsed && parsed.scores),
        lastUpdated:
          parsed && typeof parsed.lastUpdated === 'string' ? parsed.lastUpdated : null
      };
      ratingMemory = cloneRatings(data);
      return data;
    } catch (e) {
      // 隐私模式、禁用、JSON 损坏都走这里
      return ratingMemory ? cloneRatings(ratingMemory) : emptyRatings();
    }
  }

  function writeRatings(data) {
    ratingMemory = cloneRatings(data);
    try {
      global.localStorage.setItem(RATINGS_KEY, JSON.stringify(ratingMemory));
      return true;
    } catch (e) {
      ZRD.util.log('评分写入失败，已暂存内存:', e && e.message);
      return false;
    }
  }

  function addRating(score) {
    try {
      var value = Math.round(Number(score));
      if (!isFinite(value) || value < 1 || value > 5) {
        return { data: readRatings(), stored: false };
      }

      var data = readRatings();
      data.scores.push(value);
      data.lastUpdated = new Date().toISOString();

      var stored = writeRatings(data);
      return { data: cloneRatings(data), stored: stored };
    } catch (e) {
      return { data: readRatings(), stored: false };
    }
  }

  function summarizeRatings(data) {
    var scores = data && Array.isArray(data.scores) ? data.scores : [];
    var count = scores.length;
    var sum = 0;
    for (var i = 0; i < count; i++) sum += scores[i];

    return {
      count: count,
      average: count ? sum / count : 0,
      last: count ? scores[count - 1] : 0,
      lastUpdated: (data && data.lastUpdated) || null
    };
  }

  /* ---------------------------------------------------------------- 对外 API */

  var store = {
    /** localStorage 是否真正可用（false = 仅本次会话内有效） */
    get available() {
      return usable;
    },

    get: function (key, fallback) {
      var v = raw(key);
      return v == null ? fallback : v;
    },

    set: function (key, value) {
      return write(key, String(value));
    },

    remove: drop,

    getNumber: function (key, fallback) {
      var v = parseFloat(raw(key));
      return isFinite(v) ? v : fallback;
    },

    getJSON: function (key, fallback) {
      var v = raw(key);
      if (v == null) return fallback;
      try {
        return JSON.parse(v);
      } catch (e) {
        return fallback;
      }
    },

    setJSON: function (key, value) {
      try {
        return write(key, JSON.stringify(value));
      } catch (e) {
        return false;
      }
    },

    /** 评分专用：读 / 追加 / 汇总 */
    ratings: {
      read: readRatings,
      add: addRating,
      summary: summarizeRatings,
      clear: function () {
        drop(RATINGS_KEY);
      }
    },

    /** 调试用：一次性导出全部业务数据 */
    snapshot: function () {
      var keys = ZRD.config.keys;
      return {
        ratings: readRatings(),
        best: store.getNumber(keys.best, 0),
        history: store.getJSON(keys.history, [])
      };
    },

    /** 清空本页写入的业务数据（Console 调试用，不在 UI 暴露） */
    clearAll: function () {
      Object.keys(ZRD.config.keys).forEach(function (k) {
        drop(ZRD.config.keys[k]);
      });
      ratingMemory = null;
    }
  };

  ZRD.store = store;
})(window);
