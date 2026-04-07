const MIN_FREQUENCY = 1;
const MAX_FREQUENCY = 22000;
const DEFAULT_FREQUENCY = 440;
const DEFAULT_VOLUME = 0.1;
const FADE_TIME = 0.03;
const PARAM_SMOOTHING = 0.01;
const HOLD_DELAY_MS = 320;
const HOLD_INTERVAL_MS = 90;
const NOISE_BUFFER_SECONDS = 2;

const state = {
  frequency: DEFAULT_FREQUENCY,
  volume: DEFAULT_VOLUME,
  waveform: "sine",
  channel: "stereo",
  step: 10,
  isPlaying: false,
  isSweepActive: false,
  sweep: {
    start: 20,
    end: 1000,
    speed: 100,
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
  noiseBuffer: null,
  masterGainNode: null,
  mergerNode: null,
  leftGainNode: null,
  rightGainNode: null,
  stopTimeoutId: null,
  switchTimeoutId: null,
};

const sweepState = {
  frameId: null,
  lastTimestamp: 0,
};

const elements = {
  frequencyValue: document.getElementById("frequencyValue"),
  frequencyUnit: document.getElementById("frequencyUnit"),
  frequencyInput: document.getElementById("frequencyInput"),
  stepSelect: document.getElementById("stepSelect"),
  startButton: document.getElementById("startButton"),
  stopButton: document.getElementById("stopButton"),
  volumeInput: document.getElementById("volumeInput"),
  volumeValue: document.getElementById("volumeValue"),
  decreaseButton: document.getElementById("decreaseButton"),
  increaseButton: document.getElementById("increaseButton"),
  sweepStartInput: document.getElementById("sweepStartInput"),
  sweepEndInput: document.getElementById("sweepEndInput"),
  sweepSpeedInput: document.getElementById("sweepSpeedInput"),
  sweepDirectionSelect: document.getElementById("sweepDirectionSelect"),
  startSweepButton: document.getElementById("startSweepButton"),
  stopSweepButton: document.getElementById("stopSweepButton"),
  holdButton: document.getElementById("holdButton"),
  statusText: document.getElementById("statusText"),
  display: document.querySelector(".display"),
  frequencyPanel: document.getElementById("frequencyPanel"),
  sweepPanel: document.getElementById("sweepPanel"),
  waveformInputs: Array.from(document.querySelectorAll('input[name="waveform"]')),
  channelInputs: Array.from(document.querySelectorAll('input[name="channel"]')),
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function isNoiseMode() {
  return state.waveform === "noise";
}

function parseFrequency(value, fallback = state.frequency) {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return clamp(parsed, MIN_FREQUENCY, MAX_FREQUENCY);
}

function parseSweepSpeed(value, fallback = state.sweep.speed) {
  const parsed = Number.parseFloat(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return fallback;
  }

  return clamp(parsed, 0.1, 50000);
}

function formatFrequency(value) {
  if (value >= 1000) {
    return value.toLocaleString("it-IT", { maximumFractionDigits: 0 });
  }

  if (value >= 100) {
    return value.toFixed(1).replace(/\.0$/, "");
  }

  return value.toFixed(2).replace(/\.?0+$/, "");
}

function updateStatus(text) {
  elements.statusText.textContent = text;
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
  if (isNoiseMode()) {
    elements.frequencyValue.textContent = "NOISE";
    elements.frequencyUnit.hidden = true;
    elements.display.classList.add("is-noise");
  } else {
    elements.frequencyValue.textContent = formatFrequency(state.frequency);
    elements.frequencyUnit.hidden = false;
    elements.display.classList.remove("is-noise");
  }

  elements.frequencyInput.value = String(Number(state.frequency.toFixed(2)));
}

function updateVolumeUI() {
  const volumePercentage = Math.round(state.volume * 100);
  elements.volumeInput.value = String(volumePercentage);
  elements.volumeValue.textContent = `${volumePercentage}%`;
}

function updateSweepUI() {
  elements.sweepStartInput.value = String(Number(state.sweep.start.toFixed(2)));
  elements.sweepEndInput.value = String(Number(state.sweep.end.toFixed(2)));
  elements.sweepSpeedInput.value = String(Number(state.sweep.speed.toFixed(2)));
  elements.sweepDirectionSelect.value = state.sweep.direction;
}

function updateWaveformUI() {
  elements.waveformInputs.forEach((input) => {
    input.checked = input.value === state.waveform;
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
    elements.stepSelect,
    elements.decreaseButton,
    elements.increaseButton,
    elements.sweepStartInput,
    elements.sweepEndInput,
    elements.sweepSpeedInput,
    elements.sweepDirectionSelect,
  ].forEach((element) => {
    element.disabled = disabled;
  });

  elements.frequencyPanel.classList.toggle("is-disabled", disabled);
  elements.sweepPanel.classList.toggle("is-disabled", disabled);
}

function updateButtonState() {
  const disabledForNoise = isNoiseMode();

  elements.startButton.disabled = state.isPlaying;
  elements.stopButton.disabled = !state.isPlaying;
  elements.startSweepButton.disabled = disabledForNoise || state.isSweepActive;
  elements.stopSweepButton.disabled = disabledForNoise || !state.isSweepActive;
  elements.holdButton.disabled = disabledForNoise || !state.isSweepActive;
}

function syncAllUI() {
  updateFrequencyUI();
  updateVolumeUI();
  updateSweepUI();
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

  audio.masterGainNode.gain.value = 0;
  audio.leftGainNode.gain.value = 1;
  audio.rightGainNode.gain.value = 1;

  audio.masterGainNode.connect(audio.leftGainNode);
  audio.masterGainNode.connect(audio.rightGainNode);
  audio.leftGainNode.connect(audio.mergerNode, 0, 0);
  audio.rightGainNode.connect(audio.mergerNode, 0, 1);
  audio.mergerNode.connect(audio.context.destination);

  applyChannelRouting();
}

function ensureNoiseBuffer() {
  if (audio.noiseBuffer || !audio.context) {
    return;
  }

  const frameCount = Math.floor(audio.context.sampleRate * NOISE_BUFFER_SECONDS);
  const noiseBuffer = audio.context.createBuffer(1, frameCount, audio.context.sampleRate);
  const channelData = noiseBuffer.getChannelData(0);

  for (let i = 0; i < frameCount; i += 1) {
    channelData[i] = Math.random() * 2 - 1;
  }

  audio.noiseBuffer = noiseBuffer;
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
    ensureNoiseBuffer();

    const noiseSource = audio.context.createBufferSource();
    noiseSource.buffer = audio.noiseBuffer;
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
  updateStatus(isNoiseMode() ? "Noise attivo" : state.isSweepActive ? "Sweep attivo" : "Tono attivo");
  updateButtonState();
}

function stopTone() {
  stopSweep();

  if (!audio.context || !audio.masterGainNode) {
    state.isPlaying = false;
    updateStatus("Pronto");
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
  }, (FADE_TIME + 0.02) * 1000);

  state.isPlaying = false;
  updateStatus("Pronto");
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
  state.frequency = clamp(nextFrequency, MIN_FREQUENCY, MAX_FREQUENCY);
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
  state.waveform = nextWaveform;
  const isNowNoise = isNoiseMode();

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

  if (!wasNoise && !isNowNoise && audio.sourceKind === "tone") {
    audio.sourceNode.type = nextWaveform;
    updateStatus("Tono attivo");
    return;
  }

  rebuildPlayingSource();
  updateStatus(isNowNoise ? "Noise attivo" : "Tono attivo");
}

function stopSweep() {
  if (sweepState.frameId) {
    window.cancelAnimationFrame(sweepState.frameId);
    sweepState.frameId = null;
  }

  sweepState.lastTimestamp = 0;

  if (state.isSweepActive) {
    state.isSweepActive = false;
    updateStatus(state.isPlaying ? "Tono attivo" : "Pronto");
    updateButtonState();
  }
}

function readSweepInputs() {
  state.sweep.start = parseFrequency(elements.sweepStartInput.value, state.sweep.start);
  state.sweep.end = parseFrequency(elements.sweepEndInput.value, state.sweep.end);
  state.sweep.speed = parseSweepSpeed(elements.sweepSpeedInput.value, state.sweep.speed);
  state.sweep.direction = elements.sweepDirectionSelect.value;
  state.sweep.min = Math.min(state.sweep.start, state.sweep.end);
  state.sweep.max = Math.max(state.sweep.start, state.sweep.end);
  updateSweepUI();
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

  let nextFrequency = state.frequency + state.sweep.speed * elapsedSeconds * state.sweep.currentDirection;

  if (state.sweep.direction === "up") {
    if (nextFrequency >= state.sweep.end) {
      nextFrequency = state.sweep.end;
      state.isSweepActive = false;
    }
  } else if (state.sweep.direction === "down") {
    if (nextFrequency <= state.sweep.end) {
      nextFrequency = state.sweep.end;
      state.isSweepActive = false;
    }
  } else {
    if (nextFrequency > state.sweep.max) {
      const overflow = nextFrequency - state.sweep.max;
      nextFrequency = state.sweep.max - overflow;
      state.sweep.currentDirection = -1;
    } else if (nextFrequency < state.sweep.min) {
      const overflow = state.sweep.min - nextFrequency;
      nextFrequency = state.sweep.min + overflow;
      state.sweep.currentDirection = 1;
    }
  }

  setFrequency(nextFrequency);

  if (!state.isSweepActive) {
    sweepState.frameId = null;
    updateStatus(state.isPlaying ? "Tono attivo" : "Pronto");
    updateButtonState();
    return;
  }

  sweepState.frameId = window.requestAnimationFrame(advanceSweep);
}

async function startSweep() {
  if (isNoiseMode()) {
    return;
  }

  readSweepInputs();
  stopSweep();

  if (state.sweep.direction === "up") {
    if (state.sweep.start > state.sweep.end) {
      [state.sweep.start, state.sweep.end] = [state.sweep.end, state.sweep.start];
      updateSweepUI();
    }

    state.sweep.currentDirection = 1;
    setFrequency(state.sweep.start);
  } else if (state.sweep.direction === "down") {
    if (state.sweep.start < state.sweep.end) {
      [state.sweep.start, state.sweep.end] = [state.sweep.end, state.sweep.start];
      updateSweepUI();
    }

    state.sweep.currentDirection = -1;
    setFrequency(state.sweep.start);
  } else {
    state.sweep.currentDirection = state.sweep.start <= state.sweep.end ? 1 : -1;
    setFrequency(state.sweep.start);
  }

  state.sweep.min = Math.min(state.sweep.start, state.sweep.end);
  state.sweep.max = Math.max(state.sweep.start, state.sweep.end);

  if (state.sweep.min === state.sweep.max) {
    await startTone();
    updateStatus(`Hold a ${formatFrequency(state.frequency)} Hz`);
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

function holdSweep() {
  if (!state.isSweepActive) {
    return;
  }

  stopSweep();
  updateStatus(`Hold a ${formatFrequency(state.frequency)} Hz`);
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

    event.preventDefault();

    if (button.setPointerCapture) {
      button.setPointerCapture(event.pointerId);
    }

    changeFrequencyByStep(state.step * direction);

    holdTimeoutId = window.setTimeout(() => {
      repeatIntervalId = window.setInterval(() => {
        changeFrequencyByStep(state.step * direction);
      }, HOLD_INTERVAL_MS);
    }, HOLD_DELAY_MS);
  });

  ["pointerup", "pointercancel", "pointerleave", "lostpointercapture"].forEach((eventName) => {
    button.addEventListener(eventName, clearTimers);
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
  elements.startButton.addEventListener("click", () => {
    startTone().catch(() => updateStatus("Audio non disponibile"));
  });

  elements.stopButton.addEventListener("click", () => {
    stopTone();
  });

  elements.waveformInputs.forEach((input) => {
    input.addEventListener("change", (event) => {
      if (event.target.checked) {
        setWaveform(event.target.value);
      }
    });
  });

  elements.volumeInput.addEventListener("input", (event) => {
    setVolume(Number(event.target.value) / 100);
  });

  elements.channelInputs.forEach((input) => {
    input.addEventListener("change", (event) => {
      if (event.target.checked) {
        setChannel(event.target.value);
      }
    });
  });

  elements.stepSelect.addEventListener("change", (event) => {
    state.step = Number(event.target.value);
  });

  elements.frequencyInput.addEventListener("input", (event) => {
    if (event.target.value === "") {
      return;
    }

    applyManualFrequency(parseFrequency(event.target.value));
  });

  elements.frequencyInput.addEventListener("blur", () => {
    elements.frequencyInput.value = String(Number(state.frequency.toFixed(2)));
  });

  [elements.sweepStartInput, elements.sweepEndInput, elements.sweepSpeedInput].forEach((input) => {
    input.addEventListener("change", readSweepInputs);
    input.addEventListener("blur", readSweepInputs);
  });

  elements.sweepDirectionSelect.addEventListener("change", readSweepInputs);

  elements.startSweepButton.addEventListener("click", () => {
    startSweep().catch(() => updateStatus("Sweep non disponibile"));
  });

  elements.stopSweepButton.addEventListener("click", () => {
    stopSweep();
  });

  elements.holdButton.addEventListener("click", () => {
    holdSweep();
  });

  bindPressAndHold(elements.decreaseButton, -1);
  bindPressAndHold(elements.increaseButton, 1);
}

function init() {
  syncAllUI();
  updateStatus("Pronto");
  bindAudioUnlock();
  bindEvents();
}

init();
