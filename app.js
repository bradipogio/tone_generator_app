const MIN_FREQUENCY = 1;
const MAX_FREQUENCY = 22000;
const DEFAULT_FREQUENCY = 440;
const DEFAULT_VOLUME = 0.1;
const FADE_TIME = 0.03;
const PARAM_SMOOTHING = 0.01;
const HOLD_DELAY_MS = 320;
const HOLD_INTERVAL_MS = 90;

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
  oscillator: null,
  gainNode: null,
  pannerNode: null,
};

const sweepState = {
  frameId: null,
  lastTimestamp: 0,
};

const channelPanMap = {
  left: -1,
  stereo: 0,
  right: 1,
};

const elements = {
  frequencyValue: document.getElementById("frequencyValue"),
  frequencyInput: document.getElementById("frequencyInput"),
  stepSelect: document.getElementById("stepSelect"),
  startButton: document.getElementById("startButton"),
  stopButton: document.getElementById("stopButton"),
  waveformSelect: document.getElementById("waveformSelect"),
  channelSelect: document.getElementById("channelSelect"),
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
  presetButtons: Array.from(document.querySelectorAll("[data-frequency]")),
};

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
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
    return value.toLocaleString("it-IT", {
      maximumFractionDigits: 0,
    });
  }

  if (value >= 100) {
    return value.toFixed(1).replace(/\.0$/, "");
  }

  return value.toFixed(2).replace(/\.?0+$/, "");
}

function updateStatus(text) {
  elements.statusText.textContent = text;
}

function updateFrequencyUI() {
  elements.frequencyValue.textContent = formatFrequency(state.frequency);
  elements.frequencyInput.value = String(Number(state.frequency.toFixed(2)));

  elements.presetButtons.forEach((button) => {
    const presetFrequency = Number(button.dataset.frequency);
    const isActive = Math.abs(presetFrequency - state.frequency) < 0.001;
    button.classList.toggle("is-active", isActive);
  });
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

function updateButtonState() {
  elements.startButton.disabled = state.isPlaying;
  elements.stopButton.disabled = !state.isPlaying;
  elements.startSweepButton.disabled = state.isSweepActive;
  elements.stopSweepButton.disabled = !state.isSweepActive;
  elements.holdButton.disabled = !state.isSweepActive;
  elements.holdButton.classList.remove("is-active");
}

function syncAllUI() {
  updateFrequencyUI();
  updateVolumeUI();
  updateSweepUI();
  updateButtonState();
}

function ensureAudioGraph() {
  if (audio.context) {
    return;
  }

  const AudioContextClass = window.AudioContext || window.webkitAudioContext;
  audio.context = new AudioContextClass();
  audio.gainNode = audio.context.createGain();
  audio.pannerNode = audio.context.createStereoPanner();

  audio.gainNode.gain.value = 0;
  audio.pannerNode.pan.value = channelPanMap[state.channel];

  audio.gainNode.connect(audio.pannerNode);
  audio.pannerNode.connect(audio.context.destination);
}

function createOscillator() {
  const oscillator = audio.context.createOscillator();
  oscillator.type = state.waveform;
  oscillator.frequency.value = state.frequency;
  oscillator.connect(audio.gainNode);
  oscillator.start();
  audio.oscillator = oscillator;
}

async function startTone() {
  ensureAudioGraph();

  if (audio.context.state === "suspended") {
    await audio.context.resume();
  }

  if (!audio.oscillator) {
    createOscillator();
  }

  const now = audio.context.currentTime;
  audio.gainNode.gain.cancelScheduledValues(now);
  audio.gainNode.gain.setValueAtTime(audio.gainNode.gain.value, now);
  audio.gainNode.gain.linearRampToValueAtTime(state.volume, now + FADE_TIME);

  state.isPlaying = true;
  updateStatus(state.isSweepActive ? "Sweep attivo" : "Tono attivo");
  updateButtonState();
}

function stopTone() {
  stopSweep();

  if (!audio.context || !audio.gainNode) {
    state.isPlaying = false;
    updateStatus("Pronto");
    updateButtonState();
    return;
  }

  const now = audio.context.currentTime;
  audio.gainNode.gain.cancelScheduledValues(now);
  audio.gainNode.gain.setValueAtTime(audio.gainNode.gain.value, now);
  audio.gainNode.gain.linearRampToValueAtTime(0, now + FADE_TIME);

  state.isPlaying = false;
  updateStatus("Pronto");
  updateButtonState();
}

function applyFrequencyToAudio(nextFrequency) {
  if (!audio.context || !audio.oscillator) {
    return;
  }

  const now = audio.context.currentTime;
  audio.oscillator.frequency.cancelScheduledValues(now);
  audio.oscillator.frequency.setTargetAtTime(nextFrequency, now, PARAM_SMOOTHING);
}

function setFrequency(nextFrequency, options = {}) {
  const clampedFrequency = clamp(nextFrequency, MIN_FREQUENCY, MAX_FREQUENCY);
  state.frequency = clampedFrequency;
  updateFrequencyUI();

  if (!options.silentAudioUpdate) {
    applyFrequencyToAudio(clampedFrequency);
  }
}

function setWaveform(nextWaveform) {
  state.waveform = nextWaveform;
  if (audio.oscillator) {
    audio.oscillator.type = nextWaveform;
  }
}

function setVolume(nextVolume) {
  state.volume = clamp(nextVolume, 0, 1);
  updateVolumeUI();

  if (!audio.context || !audio.gainNode) {
    return;
  }

  const now = audio.context.currentTime;
  const target = state.isPlaying ? state.volume : 0;
  audio.gainNode.gain.cancelScheduledValues(now);
  audio.gainNode.gain.setTargetAtTime(target, now, PARAM_SMOOTHING);
}

function setChannel(nextChannel) {
  state.channel = nextChannel;

  if (!audio.context || !audio.pannerNode) {
    return;
  }

  const now = audio.context.currentTime;
  audio.pannerNode.pan.cancelScheduledValues(now);
  audio.pannerNode.pan.setTargetAtTime(channelPanMap[nextChannel], now, PARAM_SMOOTHING);
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

  await startTone();

  state.isSweepActive = true;
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

function bindEvents() {
  elements.startButton.addEventListener("click", () => {
    startTone().catch(() => updateStatus("Impossibile avviare l'audio"));
  });

  elements.stopButton.addEventListener("click", () => {
    stopTone();
  });

  elements.waveformSelect.addEventListener("change", (event) => {
    setWaveform(event.target.value);
  });

  elements.channelSelect.addEventListener("change", (event) => {
    setChannel(event.target.value);
  });

  elements.volumeInput.addEventListener("input", (event) => {
    const volume = Number(event.target.value) / 100;
    setVolume(volume);
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

  elements.startSweepButton.addEventListener("click", () => {
    startSweep().catch(() => updateStatus("Impossibile avviare lo sweep"));
  });

  elements.stopSweepButton.addEventListener("click", () => {
    stopSweep();
  });

  elements.holdButton.addEventListener("click", () => {
    holdSweep();
  });

  [elements.sweepStartInput, elements.sweepEndInput, elements.sweepSpeedInput].forEach((input) => {
    input.addEventListener("change", readSweepInputs);
    input.addEventListener("blur", readSweepInputs);
  });

  elements.sweepDirectionSelect.addEventListener("change", readSweepInputs);

  elements.presetButtons.forEach((button) => {
    button.addEventListener("click", () => {
      applyManualFrequency(parseFrequency(button.dataset.frequency));
    });
  });

  bindPressAndHold(elements.decreaseButton, -1);
  bindPressAndHold(elements.increaseButton, 1);
}

function init() {
  syncAllUI();
  updateStatus("Pronto");
  bindEvents();
}

init();
