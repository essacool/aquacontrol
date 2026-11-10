
/* =====================================
   AQUACONTROL - KELOMPOK 3 XII-6
   ESP32 + MQTT + Dashboard
===================================== */

const CONFIG = {
  host: "r3deb18e.ala.eu-central-1.emqxsl.com",
  port: 8084,
  path: "/mqtt",
  username: "AquaControl",
  password: "",
  device: "keran"
};

// Estimasi debit air, bukan pengukuran langsung.
const FLOW_LPM = 6;

let client = null;
let connected = false;
let currentMode = "auto";
let valveOpen = false;
let alarmActive = false;
let openStarted = null;
let usageSeconds = 0;
let usageHistory = JSON.parse(
  localStorage.getItem("aquaHistory") || "[]"
);

const $ = id => document.getElementById(id);

function setText(id, value) {
  const el = $(id);
  if (el) el.textContent = value;
}

function toast(message) {
  const el = $("toast");
  if (!el) return;
  el.textContent = message;
  el.classList.remove("hide");
  setTimeout(() => el.classList.add("hide"), 3000);
}

function logEvent(message) {
  const el = $("events");
  if (!el) return;

  const item = document.createElement("div");
  item.className = "event-item";
  item.textContent =
    new Date().toLocaleTimeString("id-ID") + " - " + message;

  el.prepend(item);
}

function updateConnection(status) {
  connected = status;

  setText("conn", status ? "Terhubung" : "Terputus");

  const el = $("conn");
  if (el) el.style.color = status ? "#35d49a" : "#ff6575";
}

function publish(topic, payload) {
  if (!client || !connected) {
    toast("MQTT belum terhubung!");
    return;
  }

  client.publish(topic, JSON.stringify(payload));
}

function command(payload) {
  publish(
    `aquacontrol/${CONFIG.device}/command`,
    payload
  );
}

function connectMQTT() {
  if (typeof mqtt === "undefined") {
    toast("Library MQTT belum tersedia.");
    return;
  }

  const host = $("host")?.value.trim() || CONFIG.host;
  const port = Number($("port")?.value || CONFIG.port);
  const path = $("path")?.value || CONFIG.path;
  const username = $("user")?.value || CONFIG.username;
  const password = $("pass")?.value || CONFIG.password;
  const device = $("device")?.value || CONFIG.device;

  CONFIG.device = device;

  client = mqtt.connect(
    `wss://${host}:${port}${path}`,
    {
      username,
      password,
      clientId: "AquaControl_" + Math.random().toString(16).slice(2),
      clean: true,
      connectTimeout: 10000,
      reconnectPeriod: 3000
    }
  );

  client.on("connect", () => {
    updateConnection(true);
    toast("Berhasil terhubung ke MQTT!");
    logEvent("Koneksi MQTT berhasil");

    client.subscribe(`aquacontrol/${device}/telemetry`);
    client.subscribe(`aquacontrol/${device}/event`);
  });

  client.on("reconnect", () => {
    setText("conn", "Menghubungkan ulang...");
  });

  client.on("error", error => {
    console.error("MQTT:", error);
    updateConnection(false);
  });

  client.on("close", () => {
    updateConnection(false);
  });

  client.on("message", (topic, message) => {
    try {
      const data = JSON.parse(message.toString());

      if (topic.endsWith("/telemetry")) {
        processTelemetry(data);
      }

      if (topic.endsWith("/event")) {
        processEvent(data);
      }
    } catch (error) {
      console.error("Data MQTT tidak valid:", error);
    }
  });
}

function disconnectMQTT() {
  if (client) {
    client.end(true);
    client = null;
  }

  updateConnection(false);
  toast("MQTT terputus");
}

function processTelemetry(data) {
  const distance =
    data.distance_cm ?? data.distance ?? null;

  if (distance !== null) {
    setText("dist", Number(distance).toFixed(1) + " cm");
  }

  if (data.valve !== undefined) {
    valveOpen =
      data.valve === true ||
      data.valve === "open" ||
      data.valve === "buka";

    updateValveDisplay();
  }

  if (data.mode) {
    currentMode = data.mode;
    updateModeDisplay();
  }

  if (data.alarm !== undefined) {
    alarmActive =
      data.alarm === true ||
      data.alarm === "active";

    updateAlarmDisplay();
  }

  updateUsageDisplay();
}

function processEvent(data) {
  const message =
    data.message || data.event || "Aktivitas baru";

  logEvent(message);

  if (data.alarm === true) {
    alarmActive = true;
    updateAlarmDisplay();
  }
}

function updateValveDisplay() {
  setText(
    "valve",
    valveOpen ? "TERBUKA" : "TERTUTUP"
  );
}

function updateModeDisplay() {
  setText(
    "modeInfo",
    currentMode === "auto"
      ? "Mode otomatis aktif"
      : "Mode manual aktif"
  );

  $("auto")?.classList.toggle(
    "selected",
    currentMode === "auto"
  );

  $("manual")?.classList.toggle(
    "selected",
    currentMode === "manual"
  );
}

function updateAlarmDisplay() {
  setText(
    "alarmText",
    alarmActive ? "Alarm aktif!" : "Tidak ada alarm"
  );

  const badge = $("alarmBadge");
  if (badge) {
    badge.textContent = alarmActive
      ? "PERINGATAN"
      : "AMAN";

    badge.style.color = alarmActive
      ? "#ff6575"
      : "#35d49a";
  }
}

function setMode(mode) {
  currentMode = mode;
  command({ mode });
  updateModeDisplay();
  toast("Mode " + mode + " dipilih");
  logEvent("Mode diubah menjadi " + mode);
}

function openValve() {
  if (currentMode !== "manual") {
    toast("Pilih mode manual terlebih dahulu!");
    return;
  }

  command({
    mode: "manual",
    valve: "open"
  });

  logEvent("Perintah membuka keran dikirim");
}

function closeValve() {
  if (currentMode !== "manual") {
    toast("Pilih mode manual terlebih dahulu!");
    return;
  }

  command({
    mode: "manual",
    valve: "closed"
  });

  logEvent("Perintah menutup keran dikirim");
}

/* =====================================
   RIWAYAT PENGGUNAAN AIR
===================================== */

function recordUsage() {
  const now = Date.now();

  if (valveOpen && openStarted === null) {
    openStarted = now;
  }

  if (!valveOpen && openStarted !== null) {
    const duration = (now - openStarted) / 1000;

    usageHistory.push({
      time: now,
      seconds: duration,
      liters: duration * FLOW_LPM / 60
    });

    openStarted = null;

    saveHistory();
    updateUsageDisplay();
  }
}

function saveHistory() {
  localStorage.setItem(
    "aquaHistory",
    JSON.stringify(usageHistory)
  );
}

function getPeriodStart(period) {
  const date = new Date();

  if (period === "daily") {
    date.setHours(0, 0, 0, 0);
  } else if (period === "weekly") {
    date.setDate(date.getDate() - 6);
    date.setHours(0, 0, 0, 0);
  } else if (period === "monthly") {
    date.setDate(1);
    date.setHours(0, 0, 0, 0);
  }

  return date.getTime();
}

function calculateUsage(period) {
  const start = getPeriodStart(period);

  return usageHistory
    .filter(item => item.time >= start)
    .reduce(
      (total, item) => total + item.liters,
      0
    );
}

function updateUsageDisplay() {
  const period = $("data-period")?.value || "daily";
  const total = calculateUsage(period);

  setText("usageTotal", total.toFixed(2) + " L");

  drawUsageChart(period);
}

function drawUsageChart(period) {
  const canvas = $("usageChart");
  if (!canvas) return;

  const ctx = canvas.getContext("2d");
  const width = canvas.width = canvas.clientWidth * 2;
  const height = canvas.height = 300;

  ctx.clearRect(0, 0, width, height);

  let labels = [];
  let values = [];

  if (period === "daily") {
    labels = Array.from({ length: 24 }, (_, i) => i + ":00");
    values = Array(24).fill(0);

    usageHistory.forEach(item => {
      const date = new Date(item.time);
      if (date.toDateString() === new Date().toDateString()) {
        values[date.getHours()] += item.liters;
      }
    });
  } else if (period === "weekly") {
    labels = ["Min", "Sen", "Sel", "Rab", "Kam", "Jum", "Sab"];
    values = Array(7).fill(0);

    usageHistory.forEach(item => {
      const date = new Date(item.time);
      if (item.time >= getPeriodStart("weekly")) {
        values[date.getDay()] += item.liters;
      }
    });
  } else {
    labels = Array.from({ length: 12 }, (_, i) => "M" + (i + 1));
    values = Array(12).fill(0);

    usageHistory.forEach(item => {
      const date = new Date(item.time);
      if (date.getFullYear() === new Date().getFullYear()) {
        values[date.getMonth()] += item.liters;
      }
    });
  }

  const max = Math.max(...values, 1);
  const barWidth = width / values.length * 0.55;

  ctx.strokeStyle = "#294158";
  ctx.fillStyle = "#20c9bd";
  ctx.font = "20px Arial";

  values.forEach((value, index) => {
    const barHeight = value / max * 190;
    const x = index * (width / values.length) +
      (width / values.length - barWidth) / 2;
    const y = height - 55 - barHeight;

    ctx.fillRect(x, y, barWidth, barHeight);

    ctx.fillStyle = "#9aafc4";
    if (values.length <= 12) {
      ctx.fillText(labels[index], x - 5, height - 20);
    }
    ctx.fillStyle = "#20c9bd";
  });
}

/* =====================================
   EVENT LISTENERS
===================================== */

document.addEventListener("DOMContentLoaded", () => {
  $("form")?.addEventListener("submit", event => {
    event.preventDefault();
    connectMQTT();
  });

  $("disconnect")?.addEventListener(
    "click",
    disconnectMQTT
  );

  $("auto")?.addEventListener(
    "click",
    () => setMode("auto")
  );

  $("manual")?.addEventListener(
    "click",
    () => setMode("manual")
  );

  $("open")?.addEventListener(
    "click",
    openValve
  );

  $("close")?.addEventListener(
    "click",
    closeValve
  );

  $("data-period")?.addEventListener(
    "change",
    updateUsageDisplay
  );

  updateConnection(false);
  updateValveDisplay();
  updateModeDisplay();
  updateAlarmDisplay();
  updateUsageDisplay();

  logEvent("Dashboard AquaControl siap");
});

/* =====================================
   UPDATE PENGGUNAAN AIR
===================================== */

setInterval(() => {
  recordUsage();

  if (valveOpen && openStarted !== null) {
    const duration = (Date.now() - openStarted) / 1000;
    setText(
      "usageDuration",
      Math.floor(duration) + " detik"
    );
  }
}, 1000);
