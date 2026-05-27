import {
  FaceLandmarker,
  FilesetResolver,
  DrawingUtils,
} from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35";

const MODEL_URL =
  "https://storage.googleapis.com/mediapipe-models/face_landmarker/face_landmarker/float16/latest/face_landmarker.task";
const WASM_URL = "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35/wasm";

const video = document.querySelector("#video");
const canvas = document.querySelector("#overlay");
const loading = document.querySelector("#loading");
const startButton = document.querySelector("#startButton");
const stopButton = document.querySelector("#stopButton");
const statusEl = document.querySelector("#status");
const mouthThresholdInput = document.querySelector("#mouthThreshold");
const eyeOpenThresholdInput = document.querySelector("#eyeOpenThreshold");
const mouthFrequencyInput = document.querySelector("#mouthFrequency");
const eyeFrequencyInput = document.querySelector("#eyeFrequency");
const dataDelayInput = document.querySelector("#dataDelay");
const mouthFrequencyLabel = document.querySelector("#mouthFrequencyLabel");
const eyeFrequencyLabel = document.querySelector("#eyeFrequencyLabel");
const mouthFrequencyValue = document.querySelector("#mouthFrequencyValue");
const eyeFrequencyValue = document.querySelector("#eyeFrequencyValue");
const delayValue = document.querySelector("#delayValue");

const meters = {
  mouthOpen: bindMeter("mouthOpen"),
  eyeOpen: bindMeter("eyeOpen"),
  mouthVolume: bindMeter("mouthVolume"),
  eyeVolume: bindMeter("eyeVolume"),
};

const ctx = canvas.getContext("2d");
const drawingUtils = new DrawingUtils(ctx);

let faceLandmarker;
let stream;
let animationFrameId = 0;
let audio;
let signalHistory = [];

startButton.addEventListener("click", start);
stopButton.addEventListener("click", stop);
mouthFrequencyInput.addEventListener("input", updateFrequencyControls);
eyeFrequencyInput.addEventListener("input", updateFrequencyControls);
dataDelayInput.addEventListener("input", updateDelayControl);

initMediaPipe();
updateFrequencyControls();
updateDelayControl();

async function initMediaPipe() {
  try {
    const vision = await FilesetResolver.forVisionTasks(WASM_URL);
    faceLandmarker = await FaceLandmarker.createFromOptions(vision, {
      baseOptions: {
        modelAssetPath: MODEL_URL,
        delegate: "GPU",
      },
      runningMode: "VIDEO",
      numFaces: 1,
    });
    loading.hidden = true;
    startButton.disabled = false;
    setStatus("Ready.");
  } catch (error) {
    loading.textContent = "MediaPipe failed to load.";
    setStatus(error.message);
  }
}

async function start() {
  startButton.disabled = true;
  setStatus("Starting camera...");

  try {
    if (!faceLandmarker) {
      setStatus("MediaPipe is still loading. Try again in a moment.");
      startButton.disabled = false;
      return;
    }

    stream = await navigator.mediaDevices.getUserMedia({
      video: {
        facingMode: "user",
        width: { ideal: 1280 },
        height: { ideal: 720 },
      },
      audio: false,
    });

    video.srcObject = stream;
    await video.play();

    audio = createAudio();
    await audio.context.resume();

    stopButton.disabled = false;
    resizeCanvas();
    setStatus("Tracking face.");
    runFrame();
  } catch (error) {
    setStatus(error.message);
    startButton.disabled = false;
    stopButton.disabled = true;
  }
}

function stop() {
  cancelAnimationFrame(animationFrameId);
  animationFrameId = 0;

  if (audio) {
    audio.mouthGain.gain.setTargetAtTime(0, audio.context.currentTime, 0.04);
    audio.eyeGain.gain.setTargetAtTime(0, audio.context.currentTime, 0.04);
    window.setTimeout(() => {
      audio.mouthOsc.stop();
      audio.eyeOsc.stop();
      audio.context.close();
      audio = null;
    }, 150);
  }

  if (stream) {
    stream.getTracks().forEach((track) => track.stop());
    stream = null;
  }

  ctx.clearRect(0, 0, canvas.width, canvas.height);
  video.srcObject = null;
  signalHistory = [];
  startButton.disabled = false;
  stopButton.disabled = true;
  setStatus("Stopped.");
  updateMeters(0, 0, 0, 0);
}

function runFrame() {
  if (!faceLandmarker || !stream) return;

  resizeCanvas();
  const result = faceLandmarker.detectForVideo(video, performance.now());
  ctx.clearRect(0, 0, canvas.width, canvas.height);

  const landmarks = result.faceLandmarks?.[0];
  if (landmarks) {
    const measurements = measureFace(landmarks);
    updateSignals(measurements);
    drawDebug(landmarks);
    setStatus("Tracking face.");
  } else {
    updateSignals({ mouthOpen: 0, eyeOpen: 1 });
    setStatus("No face detected.");
  }

  animationFrameId = requestAnimationFrame(runFrame);
}

function measureFace(landmarks) {
  const mouthWidth = distance(landmarks[61], landmarks[291]);
  const mouthHeight = distance(landmarks[13], landmarks[14]);
  const leftEyeWidth = distance(landmarks[33], landmarks[133]);
  const leftEyeHeight = average(
    distance(landmarks[159], landmarks[145]),
    distance(landmarks[158], landmarks[153])
  );
  const rightEyeWidth = distance(landmarks[362], landmarks[263]);
  const rightEyeHeight = average(
    distance(landmarks[386], landmarks[374]),
    distance(landmarks[385], landmarks[380])
  );

  const mouthRatio = mouthHeight / Math.max(mouthWidth, 0.001);
  const leftEyeRatio = leftEyeHeight / Math.max(leftEyeWidth, 0.001);
  const rightEyeRatio = rightEyeHeight / Math.max(rightEyeWidth, 0.001);

  return {
    mouthOpen: normalize(mouthRatio, 0.02, Number(mouthThresholdInput.value)),
    eyeOpen: normalize(average(leftEyeRatio, rightEyeRatio), 0.08, Number(eyeOpenThresholdInput.value)),
  };
}

function updateSignals({ mouthOpen, eyeOpen }) {
  const nowMs = performance.now();
  const delayMs = Number(dataDelayInput.value) * 1000;
  signalHistory.push({ time: nowMs, mouthOpen, eyeOpen });
  signalHistory = signalHistory.filter((sample) => sample.time >= nowMs - 2500);

  const delayedSample = getDelayedSample(nowMs - delayMs) ?? { mouthOpen, eyeOpen };
  const mouthVolume = delayedSample.mouthOpen;
  const eyeVolume = 1 - delayedSample.eyeOpen;

  if (audio) {
    const now = audio.context.currentTime;
    audio.mouthGain.gain.setValueAtTime(mouthVolume * 0.16, now);
    audio.eyeGain.gain.setValueAtTime(eyeVolume * 0.12, now);
  }

  updateMeters(mouthOpen, eyeOpen, mouthVolume, eyeVolume);
}

function createAudio() {
  const context = new AudioContext();
  const mouthOsc = new OscillatorNode(context, {
    frequency: Number(mouthFrequencyInput.value),
    type: "square",
  });
  const eyeOsc = new OscillatorNode(context, {
    frequency: Number(eyeFrequencyInput.value),
    type: "sine",
  });
  const mouthGain = new GainNode(context, { gain: 0 });
  const eyeGain = new GainNode(context, { gain: 0 });
  const masterGain = new GainNode(context, { gain: 0.85 });

  mouthOsc.connect(mouthGain);
  eyeOsc.connect(eyeGain);
  mouthGain.connect(masterGain);
  eyeGain.connect(masterGain);
  masterGain.connect(context.destination);
  mouthOsc.start();
  eyeOsc.start();

  return { context, mouthOsc, eyeOsc, mouthGain, eyeGain };
}

function getDelayedSample(targetTime) {
  for (let index = signalHistory.length - 1; index >= 0; index -= 1) {
    if (signalHistory[index].time <= targetTime) {
      return signalHistory[index];
    }
  }

  return signalHistory[0];
}

function updateFrequencyControls() {
  const mouthFrequency = Number(mouthFrequencyInput.value);
  const eyeFrequency = Number(eyeFrequencyInput.value);

  mouthFrequencyLabel.textContent = `${mouthFrequency} Hz`;
  eyeFrequencyLabel.textContent = `${eyeFrequency} Hz`;
  mouthFrequencyValue.value = `${mouthFrequency} Hz`;
  eyeFrequencyValue.value = `${eyeFrequency} Hz`;

  if (audio) {
    const now = audio.context.currentTime;
    audio.mouthOsc.frequency.setValueAtTime(mouthFrequency, now);
    audio.eyeOsc.frequency.setValueAtTime(eyeFrequency, now);
  }
}

function updateDelayControl() {
  delayValue.value = `${Number(dataDelayInput.value).toFixed(2)} s`;
}

function drawDebug(landmarks) {
  drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_LIPS, {
    color: "#8db7ff",
    lineWidth: 2,
  });
  drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_LEFT_EYE, {
    color: "#d6e4ff",
    lineWidth: 2,
  });
  drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE, {
    color: "#d6e4ff",
    lineWidth: 2,
  });
}

function resizeCanvas() {
  const width = video.videoWidth || canvas.clientWidth;
  const height = video.videoHeight || canvas.clientHeight;

  if (canvas.width !== width || canvas.height !== height) {
    canvas.width = width;
    canvas.height = height;
  }
}

function updateMeters(mouthOpen, eyeOpen, mouthVolume, eyeVolume) {
  setMeter(meters.mouthOpen, mouthOpen);
  setMeter(meters.eyeOpen, eyeOpen);
  setMeter(meters.mouthVolume, mouthVolume);
  setMeter(meters.eyeVolume, eyeVolume);
}

function bindMeter(name) {
  return {
    meter: document.querySelector(`#${name}Meter`),
    value: document.querySelector(`#${name}Value`),
  };
}

function setMeter(binding, value) {
  const clamped = clamp(value);
  binding.meter.value = clamped;
  binding.value.value = clamped.toFixed(2);
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function average(a, b) {
  return (a + b) / 2;
}

function normalize(value, low, high) {
  return clamp((value - low) / (high - low));
}

function clamp(value) {
  return Math.min(1, Math.max(0, value));
}

function setStatus(message) {
  statusEl.textContent = message;
}
