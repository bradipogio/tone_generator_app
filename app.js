const MIN_FREQUENCY = 20;
const MAX_FREQUENCY = 22000;
const DEFAULT_FREQUENCY = 440;
const DEFAULT_VOLUME = 0.1;
const FADE_TIME = 0.03;
const PARAM_SMOOTHING = 0.01;
const HOLD_DELAY_MS = 320;
const HOLD_INTERVAL_MS = 90;
const LONG_PRESS_MENU_DELAY_MS = 1000;
const NOISE_BUFFER_SECONDS = 2;
const FREQUENCY_SLIDER_MAX = 1000;
const MANUAL_FREQUENCY_STEP = 1;
const SCOPE_FPS = 12;
const SCOPE_HEIGHT = 112;
const MIC_FFT_SIZE = 8192;
const RESPONSE_BIN_COUNT = 180;
const RESPONSE_PEAK_COUNT = 5;
const RESPONSE_MIN_DB = -96;
const RESPONSE_MIN_PROMINENCE_DB = 3;
const PLAY_ICON_MARKUP =
  '<svg viewBox="0 0 32 32" focusable="false" aria-hidden="true"><path d="M11 8.5L23 16L11 23.5Z"/></svg>';
const STOP_ICON_MARKUP =
  '<svg viewBox="0 0 32 32" focusable="false" aria-hidden="true"><path d="M10 10H22V22H10Z"/></svg>';
const TONE_WAVEFORMS = new Set(["sine", "square", "triangle", "sawtooth"]);
const NOISE_WAVEFORMS = new Set(["white-noise", "pink-noise"]);
const TONE_WAVE_CONFIGS = {
  sine: {
    label: "Sinusoide",
    iconMarkup: '<path d="M2 17 C8 17 8 5 16 5 S24 29 32 29 S40 5 48 5 S56 17 62 17" />',
  },
  square: {
    label: "Quadra",
    iconMarkup: '<path d="M2 17 H14 V7 H30 V25 H46 V7 H62 V17" />',
  },
  triangle: {
    label: "Triangolo",
    iconMarkup: '<path d="M2 17 L14 7 L30 29 L46 5 L58 17 L62 17" />',
  },
  sawtooth: {
    label: "Dente",
    iconMarkup: '<path d="M2 12 L14 24 V4 L34 24 V4 L54 24 V12 H62" />',
  },
};

const state = {
  frequency: DEFAULT_FREQUENCY,
  volume: DEFAULT_VOLUME,
  waveform: "sine",
  toneWaveform: "sine",
  channel: "stereo",
  isPlaying: false,
  isSweepActive: false,
  sweep: {
    start: 20,
    end: 1000,
    duration: 15,
    direction: "up",
    min: 20,
    max: 1000,
    currentDirection: 1,
  },
};

const audio = {
  context: null,
  sourceNode: null,
  sourceKind: null,
  whiteNoiseBuffer: null,
  pinkNoiseBuffer: null,
  masterGainNode: null,
  mergerNode: null,
  analyserNode: null,
  micStream: null,
  micSourceNode: null,
  micAnalyserNode: null,
  leftGainNode: null,
  rightGainNode: null,
  stopTimeoutId: null,
  switchTimeoutId: null,
  suspendTimeoutId: null,
  audioSessionType: "",
};

const sweepState = {
  frameId: null,
  lastTimestamp: 0,
  progress: 0,
  activePointerId: null,
  activeSlider: null,
};

const scopeState = {
  frameId: null,
  lastDrawTimestamp: 0,
  buffer: null,
};

const scanState = {
  isActive: false,
  isComplete: false,
  frameId: null,
  buffer: null,
  values: Array(RESPONSE_BIN_COUNT).fill(Number.NEGATIVE_INFINITY),
  peaks: [],
  history: [],
  selectedIndex: -1,
  message: "",
  currentFrequency: null,
  minFrequency: 20,
  maxFrequency: 1000,
};

const elements = {
  frequencyInput: document.getElementById("frequencyInput"),
  frequencySlider: document.getElementById("frequencySlider"),
  powerButton: document.getElementById("powerButton"),
  powerIcon: document.getElementById("powerIcon"),
  volumeInput: document.getElementById("volumeInput"),
  volumeFill: document.getElementById("volumeFill"),
  decreaseButton: document.getElementById("decreaseButton"),
  increaseButton: document.getElementById("increaseButton"),
  sweepStartSlider: document.getElementById("sweepStartSlider"),
  sweepEndSlider: document.getElementById("sweepEndSlider"),
  sweepStartBadge: document.getElementById("sweepStartBadge"),
  sweepEndBadge: document.getElementById("sweepEndBadge"),
  sweepRangeFill: document.getElementById("sweepRangeFill"),
  sweepRange: document.getElementById("sweepRange"),
  toggleSweepButton: document.getElementById("toggleSweepButton"),
  frequencyPanel: document.getElementById("frequencyPanel"),
  sweepPanel: document.getElementById("sweepPanel"),
  wavePicker: document.getElementById("wavePicker"),
  toneFamilyButton: document.getElementById("toneFamilyButton"),
  toneFamilyIcon: document.getElementById("toneFamilyIcon"),
  toneFamilyLabel: document.getElementById("toneFamilyLabel"),
  toneWaveMenu: document.getElementById("toneWaveMenu"),
  waveformButtons: Array.from(document.querySelectorAll("[data-waveform-button]")),
  toneMenuButtons: Array.from(document.querySelectorAll("[data-wave-menu-item]")),
  channelInputs: Array.from(document.querySelectorAll('input[name="channel"]')),
  sweepDurationInputs: Array.from(document.querySelectorAll('input[name="sweepDuration"]')),
  scopePanel: document.getElementById("scopePanel"),
  scanMeta: document.getElementById("scanMeta"),
  scanNav: document.getElementById("scanNav"),
  scanCounter: document.getElementById("scanCounter"),
  scanDeleteButton: document.getElementById("scanDeleteButton"),
  scanPrevButton: document.getElementById("scanPrevButton"),
  scanNextButton: document.getElementById("scanNextButton"),
  waveformScope: document.getElementById("waveformScope"),
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function isNoiseMode(waveform = state.waveform) {
  return NOISE_WAVEFORMS.has(waveform);
}

function isToneWaveform(waveform = state.waveform) {
  return TONE_WAVEFORMS.has(waveform);
}

function getToneWaveConfig(waveform = state.toneWaveform) {
  return TONE_WAVE_CONFIGS[waveform] || TONE_WAVE_CONFIGS.sine;
}

function getActiveSourceStatus() {
  if (state.isSweepActive) {
    return "Sweep attivo";
  }

  if (state.waveform === "white-noise") {
    return "Rumore bianco attivo";
  }

  if (state.waveform === "pink-noise") {
    return "Rumore rosa attivo";
  }

  return "Tono attivo";
}

function parseFrequency(value, fallback = state.frequency) {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.round(clamp(parsed, MIN_FREQUENCY, MAX_FREQUENCY));
}

function formatFrequency(value) {
  return Math.round(value).toLocaleString("it-IT");
}

function formatCompactFrequency(value) {
  if (value >= 1000) {
    return `${(value / 1000).toLocaleString("it-IT", {
      maximumFractionDigits: value >= 10000 ? 0 : 1,
    })} k`;
  }

  return `${Math.round(value)}`;
}

function getMicErrorMessage(error) {
  if (!window.isSecureContext) {
    return "Serve HTTPS";
  }

  if (!error || !error.name) {
    return "Mic non disponibile";
  }

  if (error.name === "NotAllowedError" || error.name === "SecurityError") {
    return "Mic bloccato";
  }

  if (error.name === "NotFoundError") {
    return "Mic assente";
  }

  if (error.name === "NotReadableError" || error.name === "AbortError") {
    return "Mic occupato";
  }

  if (error.name === "OverconstrainedError") {
    return "Mic non compatibile";
  }

  return "Mic non disponibile";
}

function sliderValueToLogValue(sliderValue, minValue, maxValue, sliderMax) {
  const normalizedValue = clamp(sliderValue, 0, sliderMax) / sliderMax;
  const exponent =
    Math.log10(minValue) + normalizedValue * (Math.log10(maxValue) - Math.log10(minValue));

  return clamp(10 ** exponent, minValue, maxValue);
}

function logValueToSliderValue(value, minValue, maxValue, sliderMax) {
  const clampedValue = clamp(value, minValue, maxValue);
  const normalizedValue =
    (Math.log10(clampedValue) - Math.log10(minValue)) /
    (Math.log10(maxValue) - Math.log10(minValue));

  return Math.round(normalizedValue * sliderMax);
}

function sliderValueToFrequency(sliderValue) {
  return Math.round(
    sliderValueToLogValue(sliderValue, MIN_FREQUENCY, MAX_FREQUENCY, FREQUENCY_SLIDER_MAX),
  );
}

function frequencyToSliderValue(frequency) {
  return logValueToSliderValue(frequency, MIN_FREQUENCY, MAX_FREQUENCY, FREQUENCY_SLIDER_MAX);
}

function interpolateLogFrequency(startFrequency, endFrequency, progress) {
  const normalizedProgress = clamp(progress, 0, 1);

  if (startFrequency === endFrequency) {
    return Math.round(startFrequency);
  }

  const interpolatedExponent =
    Math.log10(startFrequency) +
    (Math.log10(endFrequency) - Math.log10(startFrequency)) * normalizedProgress;

  return Math.round(clamp(10 ** interpolatedExponent, MIN_FREQUENCY, MAX_FREQUENCY));
}

function getSweepProgressDelta(elapsedSeconds) {
  return elapsedSeconds / Math.max(state.sweep.duration, 0.1);
}

function updateStatus(text) {
  void text;
}

function getScopeContext() {
  return elements.waveformScope.getContext("2d");
}

function resizeScopeCanvas() {
  const canvas = elements.waveformScope;
  const dpr = window.devicePixelRatio || 1;
  const width = Math.max(Math.round(canvas.clientWidth * dpr), 1);
  const cssHeight = canvas.clientHeight || SCOPE_HEIGHT;
  const height = Math.max(Math.round(cssHeight * dpr), 1);

  if (canvas.width === width && canvas.height === height) {
    return;
  }

  canvas.width = width;
  canvas.height = height;
}

function clearScope() {
  resizeScopeCanvas();
  const canvas = elements.waveformScope;
  const context = getScopeContext();
  context.clearRect(0, 0, canvas.width, canvas.height);
}

function drawIdleScopeTitle() {
  resizeScopeCanvas();

  const canvas = elements.waveformScope;
  const context = getScopeContext();
  const width = canvas.width;
  const height = canvas.height;
  const dpr = window.devicePixelRatio || 1;
  const titleLines = [
    "####  ####  #   #  #####",
    "  #   #  #  ##  #  #",
    "  #   #  #  # # #  ####",
    "  #   #  #  #  ##  #",
    "  #   ####  #   #  #####",
  ];
  const subtitle = "GENERATOR";
  const fontSize = Math.max(8, Math.min(13 * dpr, width / 27));
  const lineHeight = fontSize * 1.08;
  const totalHeight = lineHeight * titleLines.length + 14 * dpr;
  const startY = height * 0.5 - totalHeight * 0.5 + lineHeight * 0.5;

  context.clearRect(0, 0, width, height);
  context.fillStyle = "#080808";
  context.fillRect(0, 0, width, height);
  context.fillStyle = "#ffe14d";
  context.font = `900 ${fontSize}px "SFMono-Regular", "Menlo", "Consolas", monospace`;
  context.textAlign = "center";
  context.textBaseline = "middle";

  titleLines.forEach((line, index) => {
    context.fillText(line, width * 0.5, startY + lineHeight * index);
  });

  context.font = `900 ${Math.max(10, 11 * dpr)}px "Avenir Next", "Segoe UI", sans-serif`;
  context.fillText(subtitle, width * 0.5, startY + lineHeight * titleLines.length + 10 * dpr);
  context.textAlign = "start";
}

function shouldDrawScope() {
  return Boolean(
    state.isPlaying &&
      !document.hidden &&
      audio.analyserNode &&
      scopeState.buffer,
  );
}

function getScopeSliceLength() {
  if (!audio.context || isNoiseMode()) {
    return scopeState.buffer ? scopeState.buffer.length : 0;
  }

  const cyclesToShow = 1.8;
  const samplesPerCycle = audio.context.sampleRate / Math.max(state.frequency, MIN_FREQUENCY);
  const desiredLength = Math.round(samplesPerCycle * cyclesToShow);

  return clamp(desiredLength, 180, scopeState.buffer.length);
}

function findRisingZeroCrossing(buffer, maxIndex) {
  for (let index = 1; index < maxIndex; index += 1) {
    if (buffer[index - 1] <= 0 && buffer[index] > 0) {
      return index;
    }
  }

  return 0;
}

function drawScope(timestamp = 0) {
  if (!shouldDrawScope()) {
    clearScope();
    scopeState.frameId = null;
    return;
  }

  scopeState.frameId = window.requestAnimationFrame(drawScope);

  if (timestamp - scopeState.lastDrawTimestamp < 1000 / SCOPE_FPS) {
    return;
  }

  scopeState.lastDrawTimestamp = timestamp;
  resizeScopeCanvas();

  const canvas = elements.waveformScope;
  const context = getScopeContext();
  const width = canvas.width;
  const height = canvas.height;
  const centerY = height * 0.5;

  context.clearRect(0, 0, width, height);

  if (!state.isPlaying) {
    return;
  }

  audio.analyserNode.getFloatTimeDomainData(scopeState.buffer);

  let startIndex = 0;
  let sliceLength = scopeState.buffer.length;

  if (!isNoiseMode()) {
    sliceLength = getScopeSliceLength();
    const searchLimit = Math.max(scopeState.buffer.length - sliceLength, 1);
    startIndex = findRisingZeroCrossing(scopeState.buffer, searchLimit);
  }

  const usableLength = Math.max(Math.min(sliceLength, scopeState.buffer.length - startIndex), 2);

  context.beginPath();
  context.lineWidth = Math.max(1.5, (window.devicePixelRatio || 1) * 1.15);
  context.strokeStyle = "#ffe14d";

  for (let point = 0; point < usableLength; point += 1) {
    const bufferIndex = startIndex + point;
    const sample = clamp(scopeState.buffer[bufferIndex], -1, 1);
    const x = (point / (usableLength - 1)) * width;
    const y = centerY + sample * (height * 0.32);

    if (point === 0) {
      context.moveTo(x, y);
    } else {
      context.lineTo(x, y);
    }
  }

  context.stroke();
}

function startScope() {
  if (scopeState.frameId || !shouldDrawScope()) {
    return;
  }

  scopeState.lastDrawTimestamp = 0;
  scopeState.frameId = window.requestAnimationFrame(drawScope);
}

function stopScope() {
  if (scopeState.frameId) {
    window.cancelAnimationFrame(scopeState.frameId);
    scopeState.frameId = null;
  }

  scopeState.lastDrawTimestamp = 0;

  if (scanState.isActive || scanState.isComplete || scanState.message) {
    drawScanGraph();
    return;
  }

  if (scanState.selectedIndex >= 0) {
    drawScanGraph();
    return;
  }

  drawIdleScopeTitle();
}

function resetMicScan() {
  scanState.isActive = false;
  scanState.isComplete = false;
  scanState.message = "";
  scanState.currentFrequency = null;
  scanState.peaks = [];
  scanState.values = Array(RESPONSE_BIN_COUNT).fill(Number.NEGATIVE_INFINITY);
  scanState.minFrequency = Math.max(Math.min(state.sweep.start, state.sweep.end), MIN_FREQUENCY);
  scanState.maxFrequency = Math.min(Math.max(state.sweep.start, state.sweep.end), MAX_FREQUENCY);
  updateScanNav();
}

function getVisibleScan() {
  if (scanState.isActive || scanState.isComplete || scanState.message) {
    return scanState;
  }

  if (scanState.selectedIndex >= 0) {
    return scanState.history[scanState.selectedIndex] || null;
  }

  return null;
}

function updateScanNav() {
  const total = scanState.history.length;
  const number = total ? scanState.selectedIndex + 1 : 0;
  const isLocked = scanState.isActive;

  elements.scanMeta.classList.toggle("is-empty", total === 0);
  elements.scanNav.classList.toggle("is-empty", total === 0);
  elements.scanCounter.textContent = total ? String(number) : "0";
  elements.scanDeleteButton.disabled = isLocked || total === 0;
  elements.scanPrevButton.disabled = isLocked || total <= 1 || scanState.selectedIndex <= 0;
  elements.scanNextButton.disabled = isLocked || total <= 1 || scanState.selectedIndex >= total - 1;
}

function showScanAt(index) {
  if (!scanState.history.length) {
    scanState.selectedIndex = -1;
    updateScanNav();
    return;
  }

  scanState.isActive = false;
  scanState.isComplete = false;
  scanState.message = "";
  scanState.selectedIndex = clamp(index, 0, scanState.history.length - 1);
  updateScanNav();
  drawScanGraph();
}

function shiftVisibleScan(direction) {
  if (scanState.isActive || !scanState.history.length) {
    return;
  }

  showScanAt(scanState.selectedIndex + direction);
}

function deleteVisibleScan() {
  if (scanState.isActive || scanState.selectedIndex < 0) {
    return;
  }

  scanState.history.splice(scanState.selectedIndex, 1);
  scanState.isComplete = false;
  scanState.message = "";

  if (!scanState.history.length) {
    scanState.selectedIndex = -1;
    updateScanNav();
    drawIdleScopeTitle();
    return;
  }

  scanState.selectedIndex = clamp(scanState.selectedIndex, 0, scanState.history.length - 1);
  updateScanNav();
  drawScanGraph();
}

function saveCurrentScanToHistory() {
  const hasValues = scanState.values.some(Number.isFinite);

  if (!hasValues) {
    updateScanNav();
    return;
  }

  scanState.history.push({
    values: [...scanState.values],
    peaks: scanState.peaks.map((peak) => ({ ...peak })),
    message: scanState.message,
    minFrequency: scanState.minFrequency,
    maxFrequency: scanState.maxFrequency,
  });

  if (scanState.history.length > 5) {
    scanState.history.shift();
  }

  scanState.selectedIndex = scanState.history.length - 1;
  updateScanNav();
}

function stopMicInput() {
  if (scanState.frameId) {
    window.cancelAnimationFrame(scanState.frameId);
    scanState.frameId = null;
  }

  if (audio.micSourceNode) {
    audio.micSourceNode.disconnect();
    audio.micSourceNode = null;
  }

  if (audio.micStream) {
    audio.micStream.getTracks().forEach((track) => track.stop());
    audio.micStream = null;
  }

  audio.micAnalyserNode = null;
  requestPlaybackAudioSession();
}

function scanIndexToFrequency(index) {
  const safeMin = Math.max(scanState.minFrequency, MIN_FREQUENCY);
  const safeMax = Math.max(scanState.maxFrequency, safeMin + 1);
  const ratio = clamp(index / Math.max(RESPONSE_BIN_COUNT - 1, 1), 0, 1);
  const exponent = Math.log10(safeMin) + ratio * (Math.log10(safeMax) - Math.log10(safeMin));

  return 10 ** exponent;
}

function frequencyToScanIndex(frequency) {
  const safeMin = Math.max(scanState.minFrequency, MIN_FREQUENCY);
  const safeMax = Math.max(scanState.maxFrequency, safeMin + 1);
  const ratio =
    (Math.log10(clamp(frequency, safeMin, safeMax)) - Math.log10(safeMin)) /
    (Math.log10(safeMax) - Math.log10(safeMin));

  return Math.round(clamp(ratio, 0, 1) * (RESPONSE_BIN_COUNT - 1));
}

function getMicLevelAtFrequency(frequency) {
  if (!audio.micAnalyserNode || !scanState.buffer || !audio.context) {
    return null;
  }

  audio.micAnalyserNode.getFloatFrequencyData(scanState.buffer);

  const binWidth = audio.context.sampleRate / audio.micAnalyserNode.fftSize;
  const centerBin = Math.round(frequency / binWidth);
  const startBin = clamp(centerBin - 2, 0, scanState.buffer.length - 1);
  const endBin = clamp(centerBin + 2, 0, scanState.buffer.length - 1);
  let total = 0;
  let count = 0;

  for (let bin = startBin; bin <= endBin; bin += 1) {
    const value = scanState.buffer[bin];

    if (Number.isFinite(value)) {
      total += value;
      count += 1;
    }
  }

  if (!count) {
    return null;
  }

  return clamp(total / count, RESPONSE_MIN_DB, 0);
}

function captureMicScanPoint() {
  if (!scanState.isActive) {
    return;
  }

  const frequency = clamp(state.frequency, scanState.minFrequency, scanState.maxFrequency);
  const level = getMicLevelAtFrequency(frequency);

  if (level === null) {
    return;
  }

  const index = frequencyToScanIndex(frequency);
  scanState.values[index] = Math.max(scanState.values[index], level);
  scanState.currentFrequency = frequency;
}

function getSmoothedScanValues() {
  return scanState.values.map((value, index, values) => {
    if (!Number.isFinite(value)) {
      return value;
    }

    let total = value;
    let count = 1;

    for (let offset = -2; offset <= 2; offset += 1) {
      if (offset === 0) {
        continue;
      }

      const neighbor = values[index + offset];

      if (Number.isFinite(neighbor)) {
        total += neighbor;
        count += 1;
      }
    }

    return total / count;
  });
}

function findScanPeaks() {
  const values = getSmoothedScanValues();
  const candidates = [];
  const minPeakDistance = Math.max(8, Math.round(RESPONSE_BIN_COUNT / 24));

  for (let index = 2; index < values.length - 2; index += 1) {
    const value = values[index];

    if (!Number.isFinite(value) || value < values[index - 1] || value < values[index + 1]) {
      continue;
    }

    const baselineValues = [];

    for (let offset = -8; offset <= 8; offset += 1) {
      if (Math.abs(offset) <= 2) {
        continue;
      }

      const baselineValue = values[index + offset];

      if (Number.isFinite(baselineValue)) {
        baselineValues.push(baselineValue);
      }
    }

    if (baselineValues.length < 3) {
      continue;
    }

    const baseline =
      baselineValues.reduce((total, baselineValue) => total + baselineValue, 0) /
      baselineValues.length;
    const prominence = value - baseline;

    if (prominence >= RESPONSE_MIN_PROMINENCE_DB) {
      candidates.push({
        frequency: scanIndexToFrequency(index),
        index,
        level: value,
        prominence,
      });
    }
  }

  return candidates
    .sort((a, b) => b.level - a.level || b.prominence - a.prominence)
    .reduce((peaks, candidate) => {
      if (peaks.length >= RESPONSE_PEAK_COUNT) {
        return peaks;
      }

      const isTooClose = peaks.some((peak) => Math.abs(peak.index - candidate.index) < minPeakDistance);

      if (!isTooClose) {
        peaks.push(candidate);
      }

      return peaks;
    }, [])
    .sort((a, b) => a.frequency - b.frequency);
}

function drawScanGraph() {
  resizeScopeCanvas();

  const visibleScan = getVisibleScan();
  const values = visibleScan ? visibleScan.values : scanState.values;
  const peaks = visibleScan ? visibleScan.peaks : scanState.peaks;
  const message = visibleScan ? visibleScan.message : scanState.message;
  const canvas = elements.waveformScope;
  const context = getScopeContext();
  const width = canvas.width;
  const height = canvas.height;
  const dpr = window.devicePixelRatio || 1;
  const left = 10 * dpr;
  const right = width - 10 * dpr;
  const top = 12 * dpr;
  const bottom = height - 14 * dpr;
  const graphWidth = Math.max(right - left, 1);
  const graphHeight = Math.max(bottom - top, 1);
  const finiteValues = values.filter(Number.isFinite);
  const minLevel = finiteValues.length
    ? Math.min(...finiteValues, Math.max(...finiteValues) - 24)
    : RESPONSE_MIN_DB;
  const maxLevel = finiteValues.length ? Math.max(...finiteValues) + 3 : -30;
  const levelRange = Math.max(maxLevel - minLevel, 12);

  const xForIndex = (index) => left + (index / Math.max(RESPONSE_BIN_COUNT - 1, 1)) * graphWidth;
  const yForLevel = (level) => bottom - ((level - minLevel) / levelRange) * graphHeight;

  context.clearRect(0, 0, width, height);
  context.fillStyle = "#080808";
  context.fillRect(0, 0, width, height);

  context.strokeStyle = "#333333";
  context.lineWidth = Math.max(1, dpr);

  for (let line = 0; line <= 3; line += 1) {
    const y = top + (graphHeight / 3) * line;
    context.beginPath();
    context.moveTo(left, y);
    context.lineTo(right, y);
    context.stroke();
  }

  if (!finiteValues.length) {
    context.fillStyle = "#ffe14d";
    context.font = `${Math.round(13 * dpr)}px "Avenir Next", "Segoe UI", sans-serif`;
    context.textBaseline = "middle";
    context.fillText(message || "SCAN", left, height * 0.5);
    return;
  }

  context.beginPath();
  context.strokeStyle = "#ffe14d";
  context.lineWidth = Math.max(3, 3 * dpr);
  context.lineJoin = "round";
  context.lineCap = "round";

  values.forEach((level, index) => {
    if (!Number.isFinite(level)) {
      return;
    }

    const x = xForIndex(index);
    const y = yForLevel(level);

    if (!index || !Number.isFinite(values[index - 1])) {
      context.moveTo(x, y);
      return;
    }

    context.lineTo(x, y);
  });

  context.stroke();

  if (scanState.isActive && scanState.currentFrequency) {
    const currentX = xForIndex(frequencyToScanIndex(scanState.currentFrequency));
    context.strokeStyle = "#36c9ff";
    context.lineWidth = Math.max(2, 2 * dpr);
    context.beginPath();
    context.moveTo(currentX, top);
    context.lineTo(currentX, bottom);
    context.stroke();
  }

  if (scanState.isActive) {
    return;
  }

  context.font = `${Math.round(11 * dpr)}px "Avenir Next", "Segoe UI", sans-serif`;
  context.textBaseline = "middle";

  peaks.forEach((peak) => {
    const x = xForIndex(peak.index);
    const y = yForLevel(peak.level);
    const label =
      peak.frequency >= 1000
        ? `${formatCompactFrequency(peak.frequency)}Hz`
        : `${formatCompactFrequency(peak.frequency)} Hz`;
    const labelWidth = context.measureText(label).width + 10 * dpr;
    const labelHeight = 17 * dpr;
    const labelX = clamp(x - labelWidth * 0.5, left, right - labelWidth);
    const labelY = clamp(y + 10 * dpr, top, bottom - labelHeight);

    context.strokeStyle = "#ff73c7";
    context.lineWidth = Math.max(2, 2 * dpr);
    context.beginPath();
    context.moveTo(x, y);
    context.lineTo(x, labelY);
    context.stroke();

    context.fillStyle = "#ffe14d";
    context.fillRect(labelX, labelY, labelWidth, labelHeight);
    context.strokeStyle = "#080808";
    context.lineWidth = Math.max(2, 2 * dpr);
    context.strokeRect(labelX, labelY, labelWidth, labelHeight);
    context.fillStyle = "#080808";
    context.fillText(label, labelX + 5 * dpr, labelY + labelHeight * 0.55);
  });
}

function drawMicScanFrame() {
  if (!scanState.isActive) {
    return;
  }

  captureMicScanPoint();
  drawScanGraph();
  scanState.frameId = window.requestAnimationFrame(drawMicScanFrame);
}

function finishMicScan() {
  if (!scanState.isActive && !scanState.isComplete) {
    return;
  }

  stopMicInput();
  scanState.isActive = false;
  scanState.isComplete = true;
  scanState.peaks = findScanPeaks();
  scanState.message = scanState.peaks.length ? "" : "Nessun picco netto";
  saveCurrentScanToHistory();
  scanState.isComplete = false;
  scanState.message = "";
  drawScanGraph();
}

async function startMicScan() {
  resetMicScan();
  stopMicInput();
  let micStream = null;

  if (!window.isSecureContext) {
    scanState.message = "Serve HTTPS";
    drawScanGraph();
    return false;
  }

  if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
    scanState.message = "Mic non disponibile";
    drawScanGraph();
    return false;
  }

  try {
    requestMicAudioSession();

    try {
      micStream = await navigator.mediaDevices.getUserMedia({
        audio: {
          autoGainControl: false,
          echoCancellation: false,
          noiseSuppression: false,
        },
      });
    } catch (constraintError) {
      if (constraintError.name === "NotAllowedError" || constraintError.name === "SecurityError") {
        throw constraintError;
      }

      micStream = await navigator.mediaDevices.getUserMedia({ audio: true });
    }

    ensureAudioGraph();
    audio.micStream = micStream;
    audio.micSourceNode = audio.context.createMediaStreamSource(micStream);
    audio.micAnalyserNode = audio.context.createAnalyser();
    audio.micAnalyserNode.fftSize = MIC_FFT_SIZE;
    audio.micAnalyserNode.minDecibels = RESPONSE_MIN_DB;
    audio.micAnalyserNode.maxDecibels = 0;
    audio.micAnalyserNode.smoothingTimeConstant = 0.18;
    audio.micSourceNode.connect(audio.micAnalyserNode);
    scanState.buffer = new Float32Array(audio.micAnalyserNode.frequencyBinCount);
    scanState.isActive = true;
    scanState.isComplete = false;
    updateScanNav();
    scanState.frameId = window.requestAnimationFrame(drawMicScanFrame);
    stopScope();
    return true;
  } catch (error) {
    if (micStream) {
      micStream.getTracks().forEach((track) => track.stop());
    }

    scanState.message = getMicErrorMessage(error);
    drawScanGraph();
    return false;
  }
}

function cancelAudioSuspend() {
  if (!audio.suspendTimeoutId) {
    return;
  }

  window.clearTimeout(audio.suspendTimeoutId);
  audio.suspendTimeoutId = null;
}

function scheduleAudioSuspend(delayMs = 0) {
  if (!audio.context || state.isPlaying) {
    return;
  }

  cancelAudioSuspend();

  const safeDelayMs = audio.stopTimeoutId
    ? Math.max(delayMs, (FADE_TIME + 0.03) * 1000)
    : delayMs;

  audio.suspendTimeoutId = window.setTimeout(() => {
    audio.suspendTimeoutId = null;

    if (!audio.context || state.isPlaying || audio.context.state !== "running") {
      return;
    }

    audio.context.suspend().catch(() => {});
  }, safeDelayMs);
}

function setAudioParamSmoothly(audioParam, value, timeConstant = PARAM_SMOOTHING) {
  if (!audio.context || !audioParam) {
    return;
  }

  const now = audio.context.currentTime;
  audioParam.cancelScheduledValues(now);
  audioParam.setTargetAtTime(value, now, timeConstant);
}

function getChannelGains(channel) {
  if (channel === "left") {
    return { left: 1, right: 0 };
  }

  if (channel === "right") {
    return { left: 0, right: 1 };
  }

  return { left: 1, right: 1 };
}

function updateFrequencyUI() {
  elements.frequencyInput.value = String(Math.round(state.frequency));
  elements.frequencySlider.value = String(frequencyToSliderValue(state.frequency));
}

function updateVolumeUI() {
  const volumePercentage = Math.round(state.volume * 100);
  elements.volumeInput.value = String(volumePercentage);
  elements.volumeFill.style.width = `${volumePercentage}%`;
}

function updateSweepUI() {
  elements.sweepStartSlider.value = String(frequencyToSliderValue(state.sweep.start));
  elements.sweepEndSlider.value = String(frequencyToSliderValue(state.sweep.end));

  const startSliderValue = Number(elements.sweepStartSlider.value);
  const endSliderValue = Number(elements.sweepEndSlider.value);
  const left = (Math.min(startSliderValue, endSliderValue) / FREQUENCY_SLIDER_MAX) * 100;
  const width = (Math.abs(endSliderValue - startSliderValue) / FREQUENCY_SLIDER_MAX) * 100;
  const sliderTrack = elements.sweepStartBadge.parentElement;
  const trackWidth = sliderTrack ? sliderTrack.clientWidth : 0;
  const startLeft = (startSliderValue / FREQUENCY_SLIDER_MAX) * trackWidth;
  const endLeft = (endSliderValue / FREQUENCY_SLIDER_MAX) * trackWidth;
  const isOverlap = Math.abs(endSliderValue - startSliderValue) < 120;
  const isStartActive = sweepState.activeSlider === elements.sweepStartSlider;
  const isEndActive = sweepState.activeSlider === elements.sweepEndSlider;

  elements.sweepRangeFill.style.left = `${left}%`;
  elements.sweepRangeFill.style.width = `${Math.max(width, 0.8)}%`;
  if (isStartActive) {
    elements.sweepStartSlider.style.zIndex = "3";
    elements.sweepEndSlider.style.zIndex = "2";
  } else if (isEndActive) {
    elements.sweepStartSlider.style.zIndex = "2";
    elements.sweepEndSlider.style.zIndex = "3";
  } else {
    elements.sweepStartSlider.style.zIndex = startSliderValue <= endSliderValue ? "2" : "3";
    elements.sweepEndSlider.style.zIndex = endSliderValue < startSliderValue ? "2" : "3";
  }
  elements.sweepStartBadge.textContent = formatFrequency(state.sweep.start);
  elements.sweepEndBadge.textContent = formatFrequency(state.sweep.end);
  elements.sweepStartBadge.classList.toggle("is-overlap", isOverlap);
  elements.sweepEndBadge.classList.toggle("is-overlap", isOverlap);

  const startHalfWidth = elements.sweepStartBadge.offsetWidth * 0.5;
  const endHalfWidth = elements.sweepEndBadge.offsetWidth * 0.5;
  const clampedStartLeft = clamp(startLeft, startHalfWidth, Math.max(trackWidth - startHalfWidth, startHalfWidth));
  const clampedEndLeft = clamp(endLeft, endHalfWidth, Math.max(trackWidth - endHalfWidth, endHalfWidth));

  elements.sweepStartBadge.style.left = `${clampedStartLeft}px`;
  elements.sweepEndBadge.style.left = `${clampedEndLeft}px`;
}

function updateSweepDurationUI() {
  elements.sweepDurationInputs.forEach((input) => {
    input.checked = Number(input.value) === state.sweep.duration;
  });
}

function updateWaveformUI() {
  const toneWaveConfig = getToneWaveConfig();
  const isToneSelected = isToneWaveform();

  elements.toneFamilyIcon.innerHTML = toneWaveConfig.iconMarkup;
  elements.toneFamilyLabel.textContent = toneWaveConfig.label;
  elements.toneFamilyButton.classList.toggle("is-active", isToneSelected);
  elements.toneFamilyButton.setAttribute("aria-pressed", String(isToneSelected));
  elements.toneFamilyButton.setAttribute(
    "aria-label",
    `${toneWaveConfig.label}. Tieni premuto per le altre onde`,
  );

  elements.waveformButtons.forEach((button) => {
    const isActive = button.dataset.waveform === state.waveform;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });

  elements.toneMenuButtons.forEach((button) => {
    const isActive = button.dataset.waveform === state.toneWaveform;
    button.classList.toggle("is-active", isActive);
    button.setAttribute("aria-pressed", String(isActive));
  });
}

function updateChannelUI() {
  elements.channelInputs.forEach((input) => {
    input.checked = input.value === state.channel;
  });
}

function updateModeUI() {
  const disabled = isNoiseMode();

  [
    elements.frequencyInput,
    elements.frequencySlider,
    elements.decreaseButton,
    elements.increaseButton,
    elements.sweepStartSlider,
    elements.sweepEndSlider,
    ...elements.sweepDurationInputs,
  ].forEach((element) => {
    element.disabled = disabled;
  });

  elements.frequencyPanel.classList.toggle("is-disabled", disabled);
  elements.sweepPanel.classList.toggle("is-disabled", disabled);
}

function updateButtonState() {
  const disabledForNoise = isNoiseMode();

  elements.powerButton.classList.toggle("is-on", state.isPlaying);
  elements.powerButton.setAttribute(
    "aria-label",
    state.isPlaying ? "Ferma audio" : "Avvia audio",
  );
  elements.powerIcon.innerHTML = state.isPlaying ? STOP_ICON_MARKUP : PLAY_ICON_MARKUP;
  elements.toggleSweepButton.disabled = disabledForNoise;
  elements.toggleSweepButton.classList.toggle("is-on", state.isSweepActive);
  elements.toggleSweepButton.textContent = state.isSweepActive ? "Stop" : "Scan";
  elements.toggleSweepButton.setAttribute(
    "aria-label",
    state.isSweepActive ? "Ferma scan" : "Avvia scan",
  );
}

function syncAllUI() {
  updateFrequencyUI();
  updateVolumeUI();
  updateSweepUI();
  updateSweepDurationUI();
  updateWaveformUI();
  updateChannelUI();
  updateModeUI();
  updateButtonState();
}

function ensureAudioGraph() {
  if (audio.context) {
    return;
  }

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  audio.context = new AudioContextClass();
  audio.masterGainNode = audio.context.createGain();
  audio.leftGainNode = audio.context.createGain();
  audio.rightGainNode = audio.context.createGain();
  audio.mergerNode = audio.context.createChannelMerger(2);
  audio.analyserNode = audio.context.createAnalyser();

  audio.masterGainNode.gain.value = 0;
  audio.leftGainNode.gain.value = 1;
  audio.rightGainNode.gain.value = 1;
  audio.analyserNode.fftSize = 8192;
  audio.analyserNode.smoothingTimeConstant = 0.08;
  scopeState.buffer = new Float32Array(audio.analyserNode.fftSize);

  audio.masterGainNode.connect(audio.leftGainNode);
  audio.masterGainNode.connect(audio.rightGainNode);
  audio.leftGainNode.connect(audio.mergerNode, 0, 0);
  audio.rightGainNode.connect(audio.mergerNode, 0, 1);
  audio.mergerNode.connect(audio.analyserNode);
  audio.analyserNode.connect(audio.context.destination);

  applyChannelRouting();
}

function createWhiteNoiseBuffer(frameCount) {
  const noiseBuffer = audio.context.createBuffer(1, frameCount, audio.context.sampleRate);
  const channelData = noiseBuffer.getChannelData(0);

  for (let index = 0; index < frameCount; index += 1) {
    channelData[index] = Math.random() * 2 - 1;
  }

  return noiseBuffer;
}

function createPinkNoiseBuffer(frameCount) {
  const noiseBuffer = audio.context.createBuffer(1, frameCount, audio.context.sampleRate);
  const channelData = noiseBuffer.getChannelData(0);
  let b0 = 0;
  let b1 = 0;
  let b2 = 0;
  let b3 = 0;
  let b4 = 0;
  let b5 = 0;
  let b6 = 0;

  for (let index = 0; index < frameCount; index += 1) {
    const white = Math.random() * 2 - 1;
    b0 = 0.99886 * b0 + white * 0.0555179;
    b1 = 0.99332 * b1 + white * 0.0750759;
    b2 = 0.969 * b2 + white * 0.153852;
    b3 = 0.8665 * b3 + white * 0.3104856;
    b4 = 0.55 * b4 + white * 0.5329522;
    b5 = -0.7616 * b5 - white * 0.016898;
    const pinkSample =
      b0 + b1 + b2 + b3 + b4 + b5 + b6 + white * 0.5362;
    b6 = white * 0.115926;
    channelData[index] = clamp(pinkSample * 0.11, -1, 1);
  }

  return noiseBuffer;
}

function ensureNoiseBuffers() {
  if (!audio.context) {
    return;
  }

  const frameCount = Math.floor(audio.context.sampleRate * NOISE_BUFFER_SECONDS);

  if (!audio.whiteNoiseBuffer) {
    audio.whiteNoiseBuffer = createWhiteNoiseBuffer(frameCount);
  }

  if (!audio.pinkNoiseBuffer) {
    audio.pinkNoiseBuffer = createPinkNoiseBuffer(frameCount);
  }
}

function stopCurrentSource(sourceNode = audio.sourceNode) {
  if (!sourceNode) {
    return;
  }

  try {
    sourceNode.stop();
  } catch (error) {
    // The node may already be stopped, which is fine.
  }

  sourceNode.disconnect();

  if (audio.sourceNode === sourceNode) {
    audio.sourceNode = null;
    audio.sourceKind = null;
  }
}

function clearScheduledSourceChanges() {
  if (audio.stopTimeoutId) {
    window.clearTimeout(audio.stopTimeoutId);
    audio.stopTimeoutId = null;
  }

  if (audio.switchTimeoutId) {
    window.clearTimeout(audio.switchTimeoutId);
    audio.switchTimeoutId = null;
  }
}

function createSource() {
  ensureAudioGraph();

  if (isNoiseMode()) {
    ensureNoiseBuffers();

    const noiseSource = audio.context.createBufferSource();
    noiseSource.buffer =
      state.waveform === "pink-noise" ? audio.pinkNoiseBuffer : audio.whiteNoiseBuffer;
    noiseSource.loop = true;
    noiseSource.connect(audio.masterGainNode);
    noiseSource.start();
    audio.sourceNode = noiseSource;
    audio.sourceKind = "noise";
    return;
  }

  const oscillator = audio.context.createOscillator();
  oscillator.type = state.waveform;
  oscillator.frequency.value = state.frequency;
  oscillator.connect(audio.masterGainNode);
  oscillator.start();
  audio.sourceNode = oscillator;
  audio.sourceKind = "tone";
}

function setAudioSessionType(type) {
  const audioSession = navigator.audioSession;

  if (!audioSession) {
    return false;
  }

  if (audio.audioSessionType === type) {
    return true;
  }

  try {
    audioSession.type = type;
    audio.audioSessionType = audioSession.type;
    return audioSession.type === type;
  } catch (error) {
    // iOS/Safari support is partial; ignore and keep the existing fallback behavior.
    return false;
  }
}

function requestPlaybackAudioSession() {
  setAudioSessionType("playback");
}

function requestMicAudioSession() {
  setAudioSessionType("play-and-record");
}

async function ensureRunningContext() {
  cancelAudioSuspend();
  requestPlaybackAudioSession();
  ensureAudioGraph();

  if (audio.context.state !== "running") {
    await audio.context.resume();
  }
}

async function startTone() {
  await ensureRunningContext();
  clearScheduledSourceChanges();

  if (!audio.sourceNode) {
    createSource();
  }

  const now = audio.context.currentTime;
  audio.masterGainNode.gain.cancelScheduledValues(now);
  audio.masterGainNode.gain.setValueAtTime(audio.masterGainNode.gain.value, now);
  audio.masterGainNode.gain.linearRampToValueAtTime(state.volume, now + FADE_TIME);

  state.isPlaying = true;

  if (!scanState.isActive) {
    startScope();
  }

  updateStatus(getActiveSourceStatus());
  updateButtonState();
}

function stopTone() {
  stopSweep();

  fadeOutAndStop("Pronto");
}

function fadeOutAndStop(nextStatus = "Pronto") {
  if (!audio.context || !audio.masterGainNode) {
    state.isPlaying = false;
    stopScope();
    updateStatus(nextStatus);
    updateButtonState();
    return;
  }

  clearScheduledSourceChanges();

  const sourceToStop = audio.sourceNode;
  const now = audio.context.currentTime;
  audio.masterGainNode.gain.cancelScheduledValues(now);
  audio.masterGainNode.gain.setValueAtTime(audio.masterGainNode.gain.value, now);
  audio.masterGainNode.gain.linearRampToValueAtTime(0, now + FADE_TIME);

  audio.stopTimeoutId = window.setTimeout(() => {
    stopCurrentSource(sourceToStop);
    audio.stopTimeoutId = null;
    scheduleAudioSuspend();
    updateStatus(nextStatus);
  }, (FADE_TIME + 0.02) * 1000);

  state.isPlaying = false;
  stopScope();
  updateStatus(nextStatus);
  updateButtonState();
}

function rebuildPlayingSource() {
  if (!state.isPlaying || !audio.context) {
    return;
  }

  clearScheduledSourceChanges();

  const previousSource = audio.sourceNode;
  const now = audio.context.currentTime;
  audio.masterGainNode.gain.cancelScheduledValues(now);
  audio.masterGainNode.gain.setValueAtTime(audio.masterGainNode.gain.value, now);
  audio.masterGainNode.gain.linearRampToValueAtTime(0, now + FADE_TIME);

  audio.switchTimeoutId = window.setTimeout(async () => {
    stopCurrentSource(previousSource);
    await ensureRunningContext();
    createSource();

    const resumeTime = audio.context.currentTime;
    audio.masterGainNode.gain.cancelScheduledValues(resumeTime);
    audio.masterGainNode.gain.setValueAtTime(0, resumeTime);
    audio.masterGainNode.gain.linearRampToValueAtTime(state.volume, resumeTime + FADE_TIME);
    audio.switchTimeoutId = null;
  }, (FADE_TIME + 0.01) * 1000);
}

function applyFrequencyToAudio(nextFrequency) {
  if (!audio.context || !audio.sourceNode || audio.sourceKind !== "tone") {
    return;
  }

  const now = audio.context.currentTime;
  audio.sourceNode.frequency.cancelScheduledValues(now);
  audio.sourceNode.frequency.setTargetAtTime(nextFrequency, now, PARAM_SMOOTHING);
}

function setFrequency(nextFrequency) {
  state.frequency = Math.round(clamp(nextFrequency, MIN_FREQUENCY, MAX_FREQUENCY));
  updateFrequencyUI();
  applyFrequencyToAudio(state.frequency);
}

function setVolume(nextVolume) {
  state.volume = clamp(nextVolume, 0, 1);
  updateVolumeUI();

  if (!audio.context || !audio.masterGainNode) {
    return;
  }

  setAudioParamSmoothly(audio.masterGainNode.gain, state.isPlaying ? state.volume : 0);
}

function applyChannelRouting() {
  if (!audio.leftGainNode || !audio.rightGainNode) {
    return;
  }

  const gains = getChannelGains(state.channel);
  setAudioParamSmoothly(audio.leftGainNode.gain, gains.left);
  setAudioParamSmoothly(audio.rightGainNode.gain, gains.right);
}

function setChannel(nextChannel) {
  state.channel = nextChannel;
  updateChannelUI();
  applyChannelRouting();
}

function setWaveform(nextWaveform) {
  const wasNoise = isNoiseMode();
  const wasTone = isToneWaveform();
  state.waveform = nextWaveform;
  const isNowNoise = isNoiseMode();
  const isNowTone = isToneWaveform();

  if (isNowTone) {
    state.toneWaveform = nextWaveform;
  }

  if (isNowNoise && state.isSweepActive) {
    stopSweep();
  }

  updateFrequencyUI();
  updateWaveformUI();
  updateModeUI();
  updateButtonState();

  if (!state.isPlaying || !audio.sourceNode) {
    return;
  }

  if (!wasNoise && !isNowNoise && wasTone && isNowTone && audio.sourceKind === "tone") {
    audio.sourceNode.type = nextWaveform;
    updateStatus(getActiveSourceStatus());
    return;
  }

  rebuildPlayingSource();
  updateStatus(getActiveSourceStatus());
}

function stopSweep() {
  if (sweepState.frameId) {
    window.cancelAnimationFrame(sweepState.frameId);
    sweepState.frameId = null;
  }

  if (scanState.isActive) {
    finishMicScan();
  }

  sweepState.lastTimestamp = 0;
  sweepState.progress = 0;

  if (state.isSweepActive) {
    state.isSweepActive = false;
    updateStatus(state.isPlaying ? getActiveSourceStatus() : "Pronto");
    updateButtonState();
  }
}

function advanceSweep(timestamp) {
  if (!state.isSweepActive) {
    return;
  }

  if (!sweepState.lastTimestamp) {
    sweepState.lastTimestamp = timestamp;
  }

  const elapsedSeconds = (timestamp - sweepState.lastTimestamp) / 1000;
  sweepState.lastTimestamp = timestamp;
  const progressDelta = getSweepProgressDelta(elapsedSeconds);

  if (state.sweep.direction === "up" || state.sweep.direction === "down") {
    sweepState.progress = clamp(sweepState.progress + progressDelta, 0, 1);
    setFrequency(interpolateLogFrequency(state.sweep.start, state.sweep.end, sweepState.progress));

    if (sweepState.progress >= 1) {
      state.isSweepActive = false;
      sweepState.frameId = null;
      sweepState.lastTimestamp = 0;
      sweepState.progress = 0;
      finishMicScan();
      fadeOutAndStop(scanState.isComplete ? "Scan completo" : "Sweep completo");
      return;
    }

    sweepState.frameId = window.requestAnimationFrame(advanceSweep);
    return;
  }

  sweepState.progress += progressDelta * state.sweep.currentDirection;

  if (sweepState.progress > 1) {
    const overflow = sweepState.progress - 1;
    sweepState.progress = 1 - overflow;
    state.sweep.currentDirection = -1;
  } else if (sweepState.progress < 0) {
    const overflow = Math.abs(sweepState.progress);
    sweepState.progress = overflow;
    state.sweep.currentDirection = 1;
  }

  setFrequency(interpolateLogFrequency(state.sweep.start, state.sweep.end, sweepState.progress));

  sweepState.frameId = window.requestAnimationFrame(advanceSweep);
}

function syncSweepFromSliders() {
  const startSliderValue = Number(elements.sweepStartSlider.value);
  const endSliderValue = Number(elements.sweepEndSlider.value);

  state.sweep.start = sliderValueToFrequency(startSliderValue);
  state.sweep.end = sliderValueToFrequency(endSliderValue);
  state.sweep.min = Math.min(state.sweep.start, state.sweep.end);
  state.sweep.max = Math.max(state.sweep.start, state.sweep.end);
  updateSweepUI();
}

function setSweepDuration(nextDuration) {
  state.sweep.duration = clamp(Number(nextDuration) || 15, 5, 30);
  updateSweepDurationUI();
}

async function startSweep() {
  if (isNoiseMode()) {
    return;
  }

  stopSweep();

  if (state.sweep.direction === "up") {
    if (state.sweep.start > state.sweep.end) {
      [state.sweep.start, state.sweep.end] = [state.sweep.end, state.sweep.start];
      updateSweepUI();
    }

    state.sweep.currentDirection = 1;
  } else if (state.sweep.direction === "down") {
    if (state.sweep.start < state.sweep.end) {
      [state.sweep.start, state.sweep.end] = [state.sweep.end, state.sweep.start];
      updateSweepUI();
    }

    state.sweep.currentDirection = 1;
  } else {
    state.sweep.currentDirection = 1;
  }

  state.sweep.min = Math.min(state.sweep.start, state.sweep.end);
  state.sweep.max = Math.max(state.sweep.start, state.sweep.end);
  sweepState.progress = 0;
  setFrequency(state.sweep.start);

  if (state.sweep.min === state.sweep.max) {
    await startTone();
    updateButtonState();
    return;
  }

  const hasMicScan = await startMicScan();
  state.isSweepActive = true;
  await startTone();
  sweepState.lastTimestamp = 0;
  updateStatus(hasMicScan ? "Scan attivo" : "Sweep attivo");
  updateButtonState();
  sweepState.frameId = window.requestAnimationFrame(advanceSweep);
}

function applyManualFrequency(nextFrequency) {
  if (isNoiseMode()) {
    return;
  }

  stopSweep();
  setFrequency(nextFrequency);
}

function changeFrequencyByStep(stepDelta) {
  applyManualFrequency(state.frequency + stepDelta);
}

function openToneWaveMenu() {
  elements.toneWaveMenu.hidden = false;
  elements.wavePicker.classList.add("is-menu-open");
  elements.toneFamilyButton.setAttribute("aria-expanded", "true");
}

function closeToneWaveMenu() {
  elements.toneWaveMenu.hidden = true;
  elements.wavePicker.classList.remove("is-menu-open");
  elements.toneFamilyButton.setAttribute("aria-expanded", "false");
}

function bindScopeResize() {
  resizeScopeCanvas();
  if (scanState.isActive || scanState.isComplete || scanState.message) {
    drawScanGraph();
  } else if (scanState.selectedIndex >= 0) {
    drawScanGraph();
  } else {
    drawIdleScopeTitle();
  }
  window.addEventListener(
    "resize",
    () => {
      if (scanState.isActive || scanState.isComplete || scanState.message || scanState.selectedIndex >= 0) {
        drawScanGraph();
        return;
      }

      drawIdleScopeTitle();
    },
    { passive: true },
  );
}

function bindPageLifecycle() {
  const stopForPowerSaving = () => {
    stopScope();

    if (state.isPlaying) {
      stopSweep();
      fadeOutAndStop("Pausa risparmio");
      return;
    }

    scheduleAudioSuspend();
  };

  const syncPowerSavingState = () => {
    if (document.hidden) {
      stopForPowerSaving();
      return;
    }

    if (state.isPlaying) {
      startScope();
    } else if (scanState.selectedIndex >= 0 || scanState.message) {
      drawScanGraph();
    } else {
      drawIdleScopeTitle();
    }
  };

  document.addEventListener("visibilitychange", syncPowerSavingState);
  window.addEventListener("pagehide", stopForPowerSaving);
}

function bindPressAndHold(button, direction) {
  let holdTimeoutId = null;
  let repeatIntervalId = null;

  const clearTimers = () => {
    if (holdTimeoutId) {
      window.clearTimeout(holdTimeoutId);
      holdTimeoutId = null;
    }

    if (repeatIntervalId) {
      window.clearInterval(repeatIntervalId);
      repeatIntervalId = null;
    }
  };

  button.addEventListener("pointerdown", (event) => {
    if (button.disabled) {
      return;
    }

    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    event.preventDefault();

    if (button.setPointerCapture) {
      button.setPointerCapture(event.pointerId);
    }

    changeFrequencyByStep(MANUAL_FREQUENCY_STEP * direction);

    holdTimeoutId = window.setTimeout(() => {
      repeatIntervalId = window.setInterval(() => {
        changeFrequencyByStep(MANUAL_FREQUENCY_STEP * direction);
      }, HOLD_INTERVAL_MS);
    }, HOLD_DELAY_MS);
  });

  ["pointerup", "pointercancel", "pointerleave", "lostpointercapture"].forEach((eventName) => {
    button.addEventListener(eventName, clearTimers);
  });
}

function bindInstantButton(button, handler) {
  let suppressClick = false;

  button.addEventListener("pointerdown", (event) => {
    if (button.disabled) {
      return;
    }

    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    suppressClick = true;
    event.preventDefault();
    handler(event);
  });

  button.addEventListener("click", (event) => {
    if (suppressClick) {
      suppressClick = false;
      event.preventDefault();
      return;
    }

    handler(event);
  });

  ["pointercancel", "lostpointercapture"].forEach((eventName) => {
    button.addEventListener(eventName, () => {
      suppressClick = false;
    });
  });
}

function bindInstantRadioOption(input, onSelect) {
  const option = input.closest("label");

  if (!option) {
    return;
  }

  option.addEventListener("pointerdown", (event) => {
    if (input.disabled) {
      return;
    }

    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    event.preventDefault();

    if (!input.checked) {
      input.checked = true;
      onSelect(input.value);
    }
  });
}

function setRangeValueFromPointer(rangeInput, clientX) {
  const rect = rangeInput.getBoundingClientRect();

  if (!rect.width) {
    return;
  }

  const min = Number(rangeInput.min || 0);
  const max = Number(rangeInput.max || 100);
  const step = Math.max(Number(rangeInput.step || 1), Number.EPSILON);
  const rawValue = min + clamp((clientX - rect.left) / rect.width, 0, 1) * (max - min);
  const steppedValue = min + Math.round((rawValue - min) / step) * step;
  const nextValue = clamp(steppedValue, min, max);

  if (Number(rangeInput.value) === nextValue) {
    return false;
  }

  rangeInput.value = String(nextValue);
  rangeInput.dispatchEvent(new Event("input", { bubbles: true }));
  return true;
}

function bindInstantRange(rangeInput) {
  let activePointerId = null;

  rangeInput.addEventListener("pointerdown", (event) => {
    if (rangeInput.disabled) {
      return;
    }

    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    activePointerId = event.pointerId;
    event.preventDefault();
    rangeInput.setPointerCapture?.(event.pointerId);
    setRangeValueFromPointer(rangeInput, event.clientX);
  });

  rangeInput.addEventListener("pointermove", (event) => {
    if (event.pointerId !== activePointerId) {
      return;
    }

    event.preventDefault();
    setRangeValueFromPointer(rangeInput, event.clientX);
  });

  ["pointerup", "pointercancel", "lostpointercapture"].forEach((eventName) => {
    rangeInput.addEventListener(eventName, (event) => {
      if (event.pointerId !== activePointerId) {
        return;
      }

      activePointerId = null;
      rangeInput.dispatchEvent(new Event("change", { bubbles: true }));
    });
  });
}

function getRangeThumbClientX(rangeInput) {
  const rect = rangeInput.getBoundingClientRect();

  if (!rect.width) {
    return rect.left;
  }

  const min = Number(rangeInput.min || 0);
  const max = Number(rangeInput.max || 100);
  const value = Number(rangeInput.value);
  const ratio = max === min ? 0 : (value - min) / (max - min);
  return rect.left + clamp(ratio, 0, 1) * rect.width;
}

function setSweepSliderValueFromPointer(rangeInput, clientX) {
  const currentValue = Number(rangeInput.value);
  const didChange = setRangeValueFromPointer(rangeInput, clientX);

  if (rangeInput === elements.sweepStartSlider && Number(rangeInput.value) > Number(elements.sweepEndSlider.value)) {
    rangeInput.value = elements.sweepEndSlider.value;
    rangeInput.dispatchEvent(new Event("input", { bubbles: true }));
    return Number(rangeInput.value) !== currentValue;
  }

  if (rangeInput === elements.sweepEndSlider && Number(rangeInput.value) < Number(elements.sweepStartSlider.value)) {
    rangeInput.value = elements.sweepStartSlider.value;
    rangeInput.dispatchEvent(new Event("input", { bubbles: true }));
    return Number(rangeInput.value) !== currentValue;
  }

  return didChange;
}

function getClosestSweepSlider(clientX) {
  const startDistance = Math.abs(clientX - getRangeThumbClientX(elements.sweepStartSlider));
  const endDistance = Math.abs(clientX - getRangeThumbClientX(elements.sweepEndSlider));

  if (startDistance === endDistance) {
    return clientX <= getRangeThumbClientX(elements.sweepStartSlider) ? elements.sweepStartSlider : elements.sweepEndSlider;
  }

  return startDistance < endDistance ? elements.sweepStartSlider : elements.sweepEndSlider;
}

function bindSweepRange(rangeElement) {
  if (!rangeElement) {
    return;
  }

  const clearActiveSweepSlider = () => {
    sweepState.activePointerId = null;
    sweepState.activeSlider = null;
    updateSweepUI();
  };

  rangeElement.addEventListener("pointerdown", (event) => {
    if (elements.sweepStartSlider.disabled || elements.sweepEndSlider.disabled) {
      return;
    }

    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    if (event.pointerType === "mouse") {
      return;
    }

    sweepState.activePointerId = event.pointerId;
    sweepState.activeSlider = getClosestSweepSlider(event.clientX);
    event.preventDefault();
    rangeElement.setPointerCapture?.(event.pointerId);
    updateSweepUI();
    setSweepSliderValueFromPointer(sweepState.activeSlider, event.clientX);
  });

  rangeElement.addEventListener("pointermove", (event) => {
    if (event.pointerId !== sweepState.activePointerId || !sweepState.activeSlider) {
      return;
    }

    event.preventDefault();
    setSweepSliderValueFromPointer(sweepState.activeSlider, event.clientX);
  });

  ["pointerup", "pointercancel", "lostpointercapture"].forEach((eventName) => {
    rangeElement.addEventListener(eventName, (event) => {
      if (sweepState.activePointerId === null || (event.pointerId !== undefined && event.pointerId !== sweepState.activePointerId)) {
        return;
      }

      const activeSlider = sweepState.activeSlider;
      clearActiveSweepSlider();
      activeSlider?.dispatchEvent(new Event("change", { bubbles: true }));
    });
  });
}

function bindToneFamilyButton() {
  let menuTimeoutId = null;
  let didLongPress = false;
  let suppressClick = false;

  const clearMenuTimer = () => {
    if (!menuTimeoutId) {
      return;
    }

    window.clearTimeout(menuTimeoutId);
    menuTimeoutId = null;
  };

  elements.toneFamilyButton.addEventListener("pointerdown", (event) => {
    if (event.pointerType === "mouse" && event.button !== 0) {
      return;
    }

    suppressClick = true;
    didLongPress = false;
    event.preventDefault();
    clearMenuTimer();
    menuTimeoutId = window.setTimeout(() => {
      didLongPress = true;
      openToneWaveMenu();
    }, LONG_PRESS_MENU_DELAY_MS);
  });

  elements.toneFamilyButton.addEventListener("pointerup", () => {
    clearMenuTimer();

    if (!didLongPress) {
      closeToneWaveMenu();
      setWaveform(state.toneWaveform);
    }

    didLongPress = false;
  });

  ["pointercancel", "lostpointercapture"].forEach((eventName) => {
    elements.toneFamilyButton.addEventListener(eventName, () => {
      clearMenuTimer();
      didLongPress = false;
      suppressClick = false;
    });
  });

  elements.toneFamilyButton.addEventListener("click", (event) => {
    if (suppressClick) {
      suppressClick = false;
      event.preventDefault();
      return;
    }

    closeToneWaveMenu();
    setWaveform(state.toneWaveform);
  });

  elements.toneFamilyButton.addEventListener("contextmenu", (event) => {
    event.preventDefault();
  });
}

function bindAudioUnlock() {
  const unlockAudio = () => {
    requestPlaybackAudioSession();

    if (!state.isPlaying || !audio.context || audio.context.state === "running") {
      return;
    }

    audio.context.resume().catch(() => {});
  };

  ["touchend", "pointerup", "click"].forEach((eventName) => {
    document.addEventListener(eventName, unlockAudio, { passive: true });
  });
}

function isEditableTarget(target) {
  return Boolean(
    target instanceof Element &&
      (target === elements.frequencyInput ||
        target.closest("#frequencyInput") ||
        (target instanceof HTMLElement && target.isContentEditable)),
  );
}

function bindSelectionGuards() {
  const preventControlSelection = (event) => {
    if (isEditableTarget(event.target)) {
      return;
    }

    if (
      event.target instanceof Element &&
      event.target.closest("button, label, input[type='range'], .app-shell")
    ) {
      event.preventDefault();
    }
  };

  document.addEventListener("selectstart", preventControlSelection);
  document.addEventListener("contextmenu", preventControlSelection);
  document.addEventListener("dragstart", preventControlSelection);
}

function bindScanNavigation() {
  let startX = 0;
  let startY = 0;
  let activePointerId = null;
  let wheelLockId = null;

  elements.scanPrevButton.addEventListener("click", () => {
    shiftVisibleScan(-1);
  });

  elements.scanNextButton.addEventListener("click", () => {
    shiftVisibleScan(1);
  });

  elements.scanDeleteButton.addEventListener("click", () => {
    deleteVisibleScan();
  });

  elements.scopePanel.addEventListener(
    "wheel",
    (event) => {
      if (scanState.history.length <= 1) {
        return;
      }

      const horizontalDelta = Math.abs(event.deltaX) > Math.abs(event.deltaY) || event.shiftKey;

      if (!horizontalDelta) {
        return;
      }

      event.preventDefault();

      if (wheelLockId) {
        return;
      }

      shiftVisibleScan(event.deltaX > 0 || event.deltaY > 0 ? 1 : -1);
      wheelLockId = window.setTimeout(() => {
        wheelLockId = null;
      }, 260);
    },
    { passive: false },
  );

  elements.scopePanel.addEventListener("pointerdown", (event) => {
    if (event.target instanceof Element && event.target.closest(".scan-nav, .scan-meta")) {
      return;
    }

    activePointerId = event.pointerId;
    startX = event.clientX;
    startY = event.clientY;
  });

  elements.scopePanel.addEventListener("pointerup", (event) => {
    if (event.pointerId !== activePointerId) {
      return;
    }

    activePointerId = null;

    if (scanState.history.length <= 1) {
      return;
    }

    const deltaX = event.clientX - startX;
    const deltaY = event.clientY - startY;

    if (Math.abs(deltaX) < 42 || Math.abs(deltaX) < Math.abs(deltaY) * 1.3) {
      return;
    }

    shiftVisibleScan(deltaX < 0 ? 1 : -1);
  });

  ["pointercancel", "lostpointercapture"].forEach((eventName) => {
    elements.scopePanel.addEventListener(eventName, () => {
      activePointerId = null;
    });
  });
}

function bindEvents() {
  elements.powerButton.addEventListener("click", () => {
    if (state.isPlaying) {
      stopTone();
      return;
    }

    startTone().catch(() => updateStatus("Audio non disponibile"));
  });

  bindToneFamilyButton();

  elements.waveformButtons.forEach((button) => {
    bindInstantButton(button, () => {
      closeToneWaveMenu();
      setWaveform(button.dataset.waveform);
    });
  });

  elements.toneMenuButtons.forEach((button) => {
    bindInstantButton(button, () => {
      closeToneWaveMenu();
      setWaveform(button.dataset.waveform);
    });
  });

  elements.volumeInput.addEventListener("input", (event) => {
    setVolume(Number(event.target.value) / 100);
  });
  bindInstantRange(elements.volumeInput);

  elements.channelInputs.forEach((input) => {
    bindInstantRadioOption(input, setChannel);
    input.addEventListener("change", (event) => {
      if (event.target.checked) {
        setChannel(event.target.value);
      }
    });
  });

  elements.frequencyInput.addEventListener("input", (event) => {
    if (event.target.value === "") {
      return;
    }

    applyManualFrequency(parseFrequency(event.target.value));
  });

  elements.frequencySlider.addEventListener("input", (event) => {
    applyManualFrequency(sliderValueToFrequency(Number(event.target.value)));
  });
  bindInstantRange(elements.frequencySlider);

  elements.frequencyInput.addEventListener("blur", () => {
    elements.frequencyInput.value = String(Math.round(state.frequency));
  });

  elements.frequencySlider.addEventListener("change", () => {
    elements.frequencySlider.value = String(frequencyToSliderValue(state.frequency));
  });

  elements.sweepStartSlider.addEventListener("input", () => {
    stopSweep();
    if (Number(elements.sweepStartSlider.value) > Number(elements.sweepEndSlider.value)) {
      elements.sweepStartSlider.value = elements.sweepEndSlider.value;
    }
    syncSweepFromSliders();
  });

  elements.sweepEndSlider.addEventListener("input", () => {
    stopSweep();
    if (Number(elements.sweepEndSlider.value) < Number(elements.sweepStartSlider.value)) {
      elements.sweepEndSlider.value = elements.sweepStartSlider.value;
    }
    syncSweepFromSliders();
  });
  bindSweepRange(elements.sweepRange);

  elements.toggleSweepButton.addEventListener("click", () => {
    if (state.isSweepActive) {
      stopSweep();
      return;
    }

    startSweep().catch(() => updateStatus("Sweep non disponibile"));
  });

  elements.sweepDurationInputs.forEach((input) => {
    bindInstantRadioOption(input, (value) => {
      stopSweep();
      setSweepDuration(value);
    });

    input.addEventListener("change", (event) => {
      if (event.target.checked) {
        stopSweep();
        setSweepDuration(event.target.value);
      }
    });
  });

  bindPressAndHold(elements.decreaseButton, -1);
  bindPressAndHold(elements.increaseButton, 1);

  document.addEventListener("pointerdown", (event) => {
    if (elements.toneWaveMenu.hidden || elements.wavePicker.contains(event.target)) {
      return;
    }

    closeToneWaveMenu();
  });

  document.addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      closeToneWaveMenu();
    }
  });
}

function init() {
  syncAllUI();
  updateStatus("Pronto");
  updateScanNav();
  bindAudioUnlock();
  bindScopeResize();
  bindPageLifecycle();
  bindSelectionGuards();
  bindScanNavigation();
  bindEvents();
}

init();
