/*
 * 烤火候大师 v1.0.0
 * 兼容目标：Chrome 61+ 的静态H5容器。
 * 不使用模块、可选链、空值合并、对象展开或内联事件。
 */
(function () {
  "use strict";

  var STORAGE_KEY = "kaohuo-master-v1";
  var ROUND_SECONDS = 45;
  var BURN_HEAT = 94;
  var MIN_TARGET = 28;
  var MAX_TARGET = 82;

  function byId(id) { return document.getElementById(id); }
  function clamp(value, min, max) { return Math.max(min, Math.min(max, value)); }
  function pad2(value) { return value < 10 ? "0" + value : "" + value; }

  function todayKey() {
    var now = new Date();
    return "" + now.getFullYear() + pad2(now.getMonth() + 1) + pad2(now.getDate());
  }

  function previousDayKey(key) {
    var year = Number(key.slice(0, 4));
    var month = Number(key.slice(4, 6)) - 1;
    var day = Number(key.slice(6, 8));
    var date = new Date(year, month, day);
    date.setDate(date.getDate() - 1);
    return "" + date.getFullYear() + pad2(date.getMonth() + 1) + pad2(date.getDate());
  }

  function hashString(value) {
    var hash = 2166136261;
    var index;
    for (index = 0; index < value.length; index += 1) {
      hash = hash ^ value.charCodeAt(index);
      hash = Math.imul(hash, 16777619);
    }
    return hash >>> 0;
  }

  function makeRandom(seed) {
    var state = seed >>> 0;
    return function () {
      state = (state + 1664525) >>> 0;
      state = Math.imul(state ^ (state >>> 16), 2246822507) >>> 0;
      state = Math.imul(state ^ (state >>> 13), 3266489909) >>> 0;
      return ((state ^ (state >>> 16)) >>> 0) / 4294967296;
    };
  }

  function dailySeed() {
    var seed = hashString(todayKey() + "-kaohuo-master");
    var random = makeRandom(seed);
    var tail = "";
    var alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    var i;
    for (i = 0; i < 3; i += 1) {
      tail += alphabet.charAt(Math.floor(random() * alphabet.length));
    }
    return pad2(new Date().getMonth() + 1) + pad2(new Date().getDate()) + "-夜市-" + tail;
  }

  function makeOrders(seedText) {
    var random = makeRandom(hashString(seedText));
    var labels = ["三分熟", "五分熟", "七分熟", "全熟"];
    var centers = [36, 49, 62, 76];
    var orders = [];
    var i;
    for (i = 0; i < 99; i += 1) {
      var type = Math.floor(random() * labels.length);
      var jitter = Math.round((random() - 0.5) * 5);
      var center = clamp(centers[type] + jitter, MIN_TARGET, MAX_TARGET);
      var halfWidth = 5 + Math.floor(random() * 3);
      orders.push({
        label: labels[type],
        min: clamp(center - halfWidth, 20, 90),
        max: clamp(center + halfWidth, 24, 92)
      });
    }
    return orders;
  }

  function loadState() {
    var state = {
      bestScore: 0,
      lastPlayedDay: "",
      streakDays: 0,
      soundEnabled: true,
      events: []
    };
    try {
      var raw = window.localStorage.getItem(STORAGE_KEY);
      if (!raw) { return state; }
      var saved = JSON.parse(raw);
      if (!saved || typeof saved !== "object") { return state; }
      state.bestScore = Number(saved.bestScore) || 0;
      state.lastPlayedDay = typeof saved.lastPlayedDay === "string" ? saved.lastPlayedDay : "";
      state.streakDays = Number(saved.streakDays) || 0;
      state.soundEnabled = saved.soundEnabled !== false;
      state.events = Array.isArray(saved.events) ? saved.events : [];
    } catch (error) {
      return state;
    }
    return state;
  }

  var state = loadState();
  var config = window.KAOHUO_CONFIG || { analyticsEndpoint: "", appVersion: "1.0.0" };
  var dailyCode = dailySeed();
  var orders = makeOrders(dailyCode);

  var welcomeScreen = byId("welcomeScreen");
  var gameScreen = byId("gameScreen");
  var resultScreen = byId("resultScreen");
  var startButton = byId("startButton");
  var soundToggle = byId("soundToggle");
  var heatButton = byId("heatButton");
  var fanButton = byId("fanButton");
  var serveButton = byId("serveButton");
  var heatTrack = byId("heatTrack");
  var targetBand = byId("targetBand");
  var heatFill = byId("heatFill");
  var heatNeedle = byId("heatNeedle");
  var grillStage = byId("grillStage");
  var gameHint = byId("gameHint");
  var liveRegion = byId("liveRegion");
  var receiptCanvas = byId("receiptCanvas");
  var audioContext = null;

  var game = {
    active: false,
    pressureHeld: false,
    heat: 25,
    score: 0,
    combo: 0,
    maxCombo: 0,
    served: 0,
    hits: 0,
    burnt: 0,
    orderIndex: 0,
    timeLeft: ROUND_SECONDS,
    lastFrame: 0,
    frameId: 0,
    timerId: 0,
    result: null
  };

  function saveState() {
    try {
      window.localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    } catch (error) {
      announce("本地存储暂不可用，成绩只在本页显示");
    }
  }

  function recordEvent(name) {
    var event = {
      name: name,
      date: todayKey(),
      version: config.appVersion
    };
    state.events.push(event);
    if (state.events.length > 100) { state.events = state.events.slice(-100); }
    saveState();
    if (config.analyticsEndpoint && window.fetch) {
      window.fetch(config.analyticsEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(event),
        keepalive: true
      }).catch(function () {});
    }
  }

  function announce(message) {
    if (liveRegion) { liveRegion.textContent = message; }
  }

  function showScreen(screen) {
    var screens = [welcomeScreen, gameScreen, resultScreen];
    var i;
    for (i = 0; i < screens.length; i += 1) {
      var item = screens[i];
      if (item === screen) {
        item.classList.remove("is-hidden");
        item.removeAttribute("hidden");
      } else {
        item.classList.add("is-hidden");
        item.setAttribute("hidden", "");
      }
    }
  }

  function updateStats() {
    byId("dailyCode").textContent = dailyCode;
    byId("bestScore").textContent = String(state.bestScore);
    byId("streakDays").textContent = state.streakDays + "天";
  }

  function setSoundText() {
    soundToggle.textContent = state.soundEnabled ? "声音开" : "声音关";
    soundToggle.setAttribute("aria-label", state.soundEnabled ? "关闭音效" : "开启音效");
    soundToggle.setAttribute("aria-pressed", state.soundEnabled ? "true" : "false");
  }

  function playTone(frequency, duration, type) {
    if (!state.soundEnabled) { return; }
    try {
      var AudioContextClass = window.AudioContext || window.webkitAudioContext;
      if (!AudioContextClass) { return; }
      if (!audioContext) { audioContext = new AudioContextClass(); }
      if (audioContext.state === "suspended" && audioContext.resume) { audioContext.resume(); }
      var oscillator = audioContext.createOscillator();
      var gain = audioContext.createGain();
      oscillator.type = type || "sine";
      oscillator.frequency.value = frequency;
      gain.gain.setValueAtTime(0.0001, audioContext.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.08, audioContext.currentTime + 0.01);
      gain.gain.exponentialRampToValueAtTime(0.0001, audioContext.currentTime + duration);
      oscillator.connect(gain);
      gain.connect(audioContext.destination);
      oscillator.start();
      oscillator.stop(audioContext.currentTime + duration + 0.02);
    } catch (error) {
      state.soundEnabled = false;
      setSoundText();
    }
  }

  function currentOrder() {
    return orders[game.orderIndex % orders.length];
  }

  function updateOrder() {
    var order = currentOrder();
    byId("orderIndex").textContent = "第 " + (game.orderIndex + 1) + " 串";
    byId("orderTitle").textContent = "顾客要" + order.label;
    byId("orderRange").textContent = order.min + "–" + order.max;
    targetBand.style.left = order.min + "%";
    targetBand.style.width = (order.max - order.min) + "%";
  }

  function updateHeatVisual() {
    heatNeedle.style.left = game.heat + "%";
    heatFill.style.width = game.heat + "%";
    heatTrack.setAttribute("aria-valuenow", String(Math.round(game.heat)));
    if (game.heat >= BURN_HEAT) { heatTrack.classList.add("is-burnt"); }
    else { heatTrack.classList.remove("is-burnt"); }
    grillStage.classList.toggle("is-hot", game.pressureHeld);
  }

  function updateScoreVisual() {
    byId("score").textContent = String(game.score);
    byId("comboText").textContent = "连击 " + game.combo;
  }

  function nextOrder() {
    game.orderIndex += 1;
    updateOrder();
  }

  function scoreForOrder(order, heat, combo) {
    var center = (order.min + order.max) / 2;
    var distance = Math.abs(heat - center);
    var accuracy = Math.round(100 - distance * 3.2);
    if (accuracy < 20) { accuracy = 20; }
    var comboBonus = Math.min(combo, 5) * 12;
    return 100 + accuracy + comboBonus;
  }

  function serve(silent) {
    if (!game.active) { return; }
    var order = currentOrder();
    var heat = game.heat;
    var hit = heat >= order.min && heat <= order.max && heat < BURN_HEAT;
    var burnt = heat >= BURN_HEAT;
    var gained = 0;
    var message;

    if (hit) {
      game.combo += 1;
      game.maxCombo = Math.max(game.maxCombo, game.combo);
      game.hits += 1;
      gained = scoreForOrder(order, heat, game.combo);
      game.score += gained;
      message = "刚刚好！+" + gained + "，连击 " + game.combo;
      playTone(620 + game.combo * 35, .14, "triangle");
    } else if (burnt) {
      game.combo = 0;
      game.burnt += 1;
      game.score = Math.max(0, game.score - 80);
      message = "焦了！营收扣80，扇风再烤一串";
      playTone(150, .22, "sawtooth");
    } else {
      game.combo = 0;
      message = heat < order.min ? "还没熟，顾客摇了摇头" : "烤过头了，顾客只要" + order.label;
      playTone(240, .12, "square");
    }

    game.served += 1;
    game.heat = 25;
    game.pressureHeld = false;
    heatButton.classList.remove("is-pressed");
    updateScoreVisual();
    updateHeatVisual();
    nextOrder();
    gameHint.textContent = message;
    announce(message);
    if (!silent) { recordEvent("serve_" + (hit ? "hit" : burnt ? "burnt" : "miss")); }
  }

  function frame(timestamp) {
    if (!game.active) { return; }
    if (!game.lastFrame) { game.lastFrame = timestamp; }
    var delta = Math.min((timestamp - game.lastFrame) / 1000, .05);
    game.lastFrame = timestamp;

    if (game.pressureHeld) { game.heat += 22 * delta; }
    else { game.heat -= 3.2 * delta; }
    game.heat = clamp(game.heat, 12, 100);

    if (game.heat >= BURN_HEAT) {
      gameHint.textContent = "快焦了！扇风或直接出餐止损";
    }
    updateHeatVisual();
    game.frameId = window.requestAnimationFrame(frame);
  }

  function tickTimer() {
    if (!game.active) { return; }
    var now = Date.now();
    var elapsed = (now - game.timerStart) / 1000;
    game.timeLeft = Math.max(0, ROUND_SECONDS - elapsed);
    byId("timeLeft").textContent = game.timeLeft.toFixed(1);
    if (game.timeLeft <= 0) { finishGame(); }
  }

  function stopLoop() {
    game.active = false;
    game.pressureHeld = false;
    heatButton.classList.remove("is-pressed");
    if (game.frameId) { window.cancelAnimationFrame(game.frameId); }
    if (game.timerId) { window.clearInterval(game.timerId); }
    game.frameId = 0;
    game.timerId = 0;
  }

  function startGame() {
    stopLoop();
    game.active = true;
    game.heat = 25;
    game.score = 0;
    game.combo = 0;
    game.maxCombo = 0;
    game.served = 0;
    game.hits = 0;
    game.burnt = 0;
    game.orderIndex = 0;
    game.timeLeft = ROUND_SECONDS;
    game.lastFrame = 0;
    game.timerStart = Date.now();
    game.result = null;
    byId("timeLeft").textContent = ROUND_SECONDS.toFixed(1);
    gameHint.textContent = "先按住加火，火候会持续上升。";
    updateScoreVisual();
    updateOrder();
    updateHeatVisual();
    showScreen(gameScreen);
    recordEvent("game_start");
    announce("营业开始，45秒");
    game.timerId = window.setInterval(tickTimer, 100);
    game.frameId = window.requestAnimationFrame(frame);
  }

  function rankFor(score) {
    if (score >= 2600) { return { title: "夜市火候传说", note: "摊主们已经开始研究你的出餐节奏。" }; }
    if (score >= 1900) { return { title: "街区烤串王", note: "火候稳，手也快，顾客愿意排队。" }; }
    if (score >= 1200) { return { title: "竹签节奏大师", note: "你已经摸到好味区，只差一点连击。" }; }
    if (score >= 650) { return { title: "见习摊主", note: "再练几次，就能把五分熟烤成招牌。" }; }
    return { title: "焦香练习生", note: "别急，火候游戏最怕手快。" };
  }

  function updateStreak() {
    var today = todayKey();
    if (state.lastPlayedDay === today) { return; }
    if (state.lastPlayedDay === previousDayKey(today)) { state.streakDays += 1; }
    else { state.streakDays = 1; }
    state.lastPlayedDay = today;
  }

  function finishGame() {
    if (!game.active) { return; }
    stopLoop();
    var accuracy = game.served ? Math.round(game.hits / game.served * 100) : 0;
    var rank = rankFor(game.score);
    var newRecord = game.score > state.bestScore;
    if (newRecord) { state.bestScore = game.score; }
    updateStreak();
    game.result = {
      score: game.score,
      accuracy: accuracy,
      maxCombo: game.maxCombo,
      served: game.served,
      hits: game.hits,
      burnt: game.burnt,
      rank: rank,
      newRecord: newRecord
    };
    saveState();
    updateStats();
    drawReceipt(game.result);
    byId("resultSummary").textContent = rank.note;
    byId("resultStamp").classList.toggle("is-visible", newRecord);
    byId("copyStatus").textContent = "";
    showScreen(resultScreen);
    recordEvent("game_finish");
    announce("营业结束，得分" + game.score);
    playTone(520, .18, "triangle");
  }

  function drawDashedLine(context, x1, y1, x2, y2) {
    context.beginPath();
    context.setLineDash([12, 10]);
    context.moveTo(x1, y1);
    context.lineTo(x2, y2);
    context.stroke();
    context.setLineDash([]);
  }

  function drawRoundedRect(context, x, y, width, height, radius) {
    context.beginPath();
    context.moveTo(x + radius, y);
    context.lineTo(x + width - radius, y);
    context.quadraticCurveTo(x + width, y, x + width, y + radius);
    context.lineTo(x + width, y + height - radius);
    context.quadraticCurveTo(x + width, y + height, x + width - radius, y + height);
    context.lineTo(x + radius, y + height);
    context.quadraticCurveTo(x, y + height, x, y + height - radius);
    context.lineTo(x, y + radius);
    context.quadraticCurveTo(x, y, x + radius, y);
    context.closePath();
  }

  function drawReceipt(result) {
    var context = receiptCanvas.getContext("2d");
    if (!context) { return; }
    var width = receiptCanvas.width;
    var height = receiptCanvas.height;
    var jagged = 18;
    var i;

    context.clearRect(0, 0, width, height);
    context.fillStyle = "#f2d8a8";
    context.beginPath();
    context.moveTo(0, 0);
    context.lineTo(width, 0);
    context.lineTo(width, height - jagged);
    for (i = 0; i <= 12; i += 1) {
      var x = width - i * (width / 12);
      var y = height - (i % 2 === 0 ? 0 : jagged);
      context.lineTo(x, y);
    }
    context.closePath();
    context.fill();

    context.strokeStyle = "rgba(23,48,51,.16)";
    context.lineWidth = 2;
    for (i = 0; i < 8; i += 1) {
      context.beginPath();
      context.moveTo(42 + i * 92, 0);
      context.bezierCurveTo(24 + i * 92, 340, 68 + i * 92, 680, 30 + i * 92, height);
      context.stroke();
    }

    context.fillStyle = "#173033";
    context.textAlign = "center";
    context.font = "bold 27px 'Microsoft YaHei', sans-serif";
    context.fillText("夜 市 火 候 局", width / 2, 92);
    context.font = "20px 'Microsoft YaHei', sans-serif";
    context.fillStyle = "#8b442e";
    context.fillText("烤火候大师 · 今日战绩", width / 2, 132);

    context.strokeStyle = "#173033";
    drawDashedLine(context, 58, 158, width - 58, 158);

    context.fillStyle = "#173033";
    context.font = "22px 'Microsoft YaHei', sans-serif";
    context.fillText("今日营收", width / 2, 214);
    context.font = "bold 92px Georgia, serif";
    context.fillText(String(result.score), width / 2, 312);

    context.fillStyle = "#8b442e";
    context.fillRect(72, 351, width - 144, 88);
    context.fillStyle = "#f2d8a8";
    context.font = "bold 38px STKaiti, KaiTi, serif";
    context.fillText(result.rank.title, width / 2, 409);

    context.fillStyle = "#173033";
    context.textAlign = "left";
    context.font = "25px 'Microsoft YaHei', sans-serif";
    var rows = [
      ["出餐", result.served + " 串"],
      ["命中", result.hits + " 串"],
      ["命中率", result.accuracy + "%"],
      ["最高连击", result.maxCombo + " 次"],
      ["焦糊", result.burnt + " 串"]
    ];
    for (i = 0; i < rows.length; i += 1) {
      var rowY = 492 + i * 54;
      context.fillText(rows[i][0], 82, rowY);
      context.textAlign = "right";
      context.fillText(rows[i][1], width - 82, rowY);
      context.textAlign = "left";
      context.strokeStyle = "rgba(23,48,51,.2)";
      drawDashedLine(context, 82, rowY + 14, width - 82, rowY + 14);
    }

    context.textAlign = "center";
    context.fillStyle = "#8b442e";
    context.font = "20px 'Microsoft YaHei', sans-serif";
    context.fillText("今天在第 " + (result.hits + 1) + " 串附近最容易翻车，来试试这个口令。", width / 2, 806);

    context.strokeStyle = "#173033";
    drawDashedLine(context, 58, 840, width - 58, 840);
    context.fillStyle = "#173033";
    context.font = "bold 31px 'Microsoft YaHei', sans-serif";
    context.fillText(dailyCode, width / 2, 898);
    context.font = "20px 'Microsoft YaHei', sans-serif";
    context.fillText("搜同款口令 · 挑战我的火候", width / 2, 944);

    context.save();
    context.translate(width - 145, 1000);
    context.rotate(-0.16);
    context.strokeStyle = "#c74a3d";
    context.lineWidth = 4;
    drawRoundedRect(context, -96, -34, 192, 68, 34);
    context.stroke();
    context.fillStyle = "#c74a3d";
    context.font = "bold 24px STKaiti, KaiTi, serif";
    context.fillText(result.newRecord ? "新纪录" : "今日盖章", 0, 9);
    context.restore();
    recordEvent("result_card_drawn");
  }

  function challengeText() {
    var result = game.result;
    if (!result) { return ""; }
    return "我在「烤火候大师」拿到" + result.score + "分，称号是「" + result.rank.title + "」。今日口令：" + dailyCode + "。来试试能不能超过我。";
  }

  function fallbackCopy(text) {
    var input = document.createElement("textarea");
    input.value = text;
    input.setAttribute("readonly", "readonly");
    input.style.position = "fixed";
    input.style.left = "-9999px";
    document.body.appendChild(input);
    input.select();
    var copied = false;
    try { copied = document.execCommand("copy"); } catch (error) { copied = false; }
    document.body.removeChild(input);
    return copied;
  }

  function copyChallenge() {
    var text = challengeText();
    var status = byId("copyStatus");
    if (window.navigator.clipboard && window.navigator.clipboard.writeText) {
      window.navigator.clipboard.writeText(text).then(function () {
        status.textContent = "挑战文案已复制，去找朋友比火候";
        recordEvent("copy_challenge");
      }).catch(function () {
        status.textContent = fallbackCopy(text) ? "挑战文案已复制" : "复制失败，请长按结果卡保存后手动配文";
      });
    } else {
      status.textContent = fallbackCopy(text) ? "挑战文案已复制" : "复制失败，请长按结果卡保存后手动配文";
      if (fallbackCopy(text)) { recordEvent("copy_challenge"); }
    }
  }

  function downloadReceipt() {
    recordEvent("save_result_card");
    var link = document.createElement("a");
    link.download = "烤火候大师-" + dailyCode + "-" + game.result.score + "分.png";
    try {
      link.href = receiptCanvas.toDataURL("image/png");
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      byId("copyStatus").textContent = "战绩图已开始下载；也可以长按图片保存";
    } catch (error) {
      byId("copyStatus").textContent = "下载失败，请长按结果卡图片保存";
    }
  }

  function shareReceipt() {
    recordEvent("share_result_card");
    if (!window.navigator.share) { return; }
    var result = game.result;
    window.navigator.share({
      title: "烤火候大师",
      text: challengeText()
    }).then(function () {
      byId("copyStatus").textContent = "已呼出系统分享";
    }).catch(function () {
      byId("copyStatus").textContent = "分享已取消，也可以保存图片再发";
    });
    if (result && receiptCanvas.toBlob && window.navigator.canShare) { /* 静态容器可能不支持文件分享，保持降级 */ }
  }

  function onHeatPressStart(event) {
    if (!game.active) { return; }
    event.preventDefault();
    game.pressureHeld = true;
    heatButton.classList.add("is-pressed");
    playTone(330, .06, "sine");
  }

  function onHeatPressEnd(event) {
    if (!game.active) { return; }
    if (event) { event.preventDefault(); }
    game.pressureHeld = false;
    heatButton.classList.remove("is-pressed");
  }

  function fanHeat() {
    if (!game.active) { return; }
    game.heat = Math.max(12, game.heat - 12);
    updateHeatVisual();
    gameHint.textContent = "一阵风，把火候压下来一点";
    playTone(420, .08, "sine");
  }

  function onKeyDown(event) {
    if (!game.active) {
      if (event.key === "Enter" || event.key === " ") {
        if (document.activeElement === startButton) { startGame(); }
      }
      return;
    }
    if (event.key === "ArrowUp" || event.key === " ") {
      if (event.repeat) { return; }
      event.preventDefault();
      onHeatPressStart(event);
    } else if (event.key === "ArrowDown" || event.key.toLowerCase() === "f") {
      event.preventDefault();
      fanHeat();
    } else if (event.key === "Enter" || event.key.toLowerCase() === "s") {
      event.preventDefault();
      serve(false);
    }
  }

  function onKeyUp(event) {
    if (!game.active) { return; }
    if (event.key === "ArrowUp" || event.key === " ") {
      event.preventDefault();
      onHeatPressEnd(event);
    }
  }

  startButton.addEventListener("click", function () {
    recordEvent("home_open");
    startGame();
  });
  soundToggle.addEventListener("click", function () {
    state.soundEnabled = !state.soundEnabled;
    setSoundText();
    saveState();
    if (state.soundEnabled) { playTone(520, .08, "triangle"); }
  });
  heatButton.addEventListener("pointerdown", onHeatPressStart);
  heatButton.addEventListener("pointerup", onHeatPressEnd);
  heatButton.addEventListener("pointercancel", onHeatPressEnd);
  heatButton.addEventListener("pointerleave", onHeatPressEnd);
  heatButton.addEventListener("contextmenu", function (event) { event.preventDefault(); });
  fanButton.addEventListener("click", fanHeat);
  serveButton.addEventListener("click", function () { serve(false); });
  byId("restartButton").addEventListener("click", startGame);
  byId("downloadButton").addEventListener("click", downloadReceipt);
  byId("copyButton").addEventListener("click", copyChallenge);
  byId("shareButton").addEventListener("click", shareReceipt);
  document.addEventListener("keydown", onKeyDown);
  document.addEventListener("keyup", onKeyUp);
  document.addEventListener("visibilitychange", function () {
    if (document.hidden && game.active) { onHeatPressEnd(null); }
  });

  if (window.navigator.share) {
    byId("shareButton").classList.remove("is-hidden");
    byId("shareButton").removeAttribute("hidden");
  }

  updateStats();
  setSoundText();
  updateOrder();
  updateHeatVisual();
  showScreen(welcomeScreen);
  recordEvent("page_view");

  window.__KAOHUO_TEST__ = {
    dailySeed: dailySeed,
    makeOrders: makeOrders,
    makeRandom: makeRandom,
    hashString: hashString,
    rankFor: rankFor,
    scoreForOrder: scoreForOrder,
    previousDayKey: previousDayKey,
    startGame: startGame,
    finishGame: finishGame,
    serve: serve,
    getGame: function () { return game; },
    getDailyCode: function () { return dailyCode; }
  };
}());
