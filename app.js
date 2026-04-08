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
const SCOPE_FPS = 30;
const SCOPE_HEIGHT = 112;
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
  leftGainNode: null,
  rightGainNode: null,
  stopTimeoutId: null,
  switchTimeoutId: null,
};

const sweepState = {
  frameId: null,
  lastTimestamp: 0,
  progress: 0,
};

const scopeState = {
  frameId: null,
  lastDrawTimestamp: 0,
  buffer: null,
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
  const height = Math.max(Math.round(SCOPE_HEIGHT * dpr), 1);

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
  if (!audio.analyserNode || !scopeState.buffer) {
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
  context.strokeStyle = "#ffd54f";

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
  if (scopeState.frameId) {
    return;
  }

  scopeState.lastDrawTimestamp = 0;
  scopeState.frameId = window.requestAnimationFrame(drawScope);
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

  elements.sweepRangeFill.style.left = `${left}%`;
  elements.sweepRangeFill.style.width = `${Math.max(width, 0.8)}%`;
  elements.sweepStartSlider.style.zIndex = startSliderValue <= endSliderValue ? "2" : "3";
  elements.sweepEndSlider.style.zIndex = endSliderValue < startSliderValue ? "2" : "3";
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
  elements.toggleSweepButton.textContent = state.isSweepActive ? "Stop" : "Sweep";
  elements.toggleSweepButton.setAttribute(
    "aria-label",
    state.isSweepActive ? "Ferma sweep" : "Avvia sweep",
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
  startScope();
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

async function ensureRunningContext() {
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
    updateStatus(nextStatus);
  }, (FADE_TIME + 0.02) * 1000);

  state.isPlaying = false;
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
      fadeOutAndStop("Sweep completo");
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

  state.isSweepActive = true;
  await startTone();
  sweepState.lastTimestamp = 0;
  updateStatus("Sweep attivo");
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
  clearScope();
  window.addEventListener("resize", resizeScopeCanvas, { passive: true });
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
    return;
  }

  rangeInput.value = String(nextValue);
  rangeInput.dispatchEvent(new Event("input", { bubbles: true }));
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
    if (!audio.context || audio.context.state === "running") {
      return;
    }

    audio.context.resume().catch(() => {});
  };

  ["touchend", "pointerup", "click"].forEach((eventName) => {
    document.addEventListener(eventName, unlockAudio, { passive: true });
  });
}

function bindEvents() {
  bindInstantButton(elements.powerButton, () => {
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

  bindInstantButton(elements.toggleSweepButton, () => {
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
  bindAudioUnlock();
  bindScopeResize();
  bindEvents();
}

init();
