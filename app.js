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
const smoothingInput = document.querySelector("#smoothing");

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
let smoothedMouthVolume = 0;
let smoothedEyeVolume = 0;
let smoothedMouthOpen = 0;
let smoothedEyeOpen = 0;

startButton.addEventListener("click", start);
stopButton.addEventListener("click", stop);

initMediaPipe();

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
  const smoothing = Number(smoothingInput.value);
  const targetMouthVolume = mouthOpen;
  const targetEyeVolume = 1 - eyeOpen;

  smoothedMouthOpen = lerp(smoothedMouthOpen, mouthOpen, smoothing);
  smoothedEyeOpen = lerp(smoothedEyeOpen, eyeOpen, smoothing);
  smoothedMouthVolume = lerp(smoothedMouthVolume, targetMouthVolume, smoothing);
  smoothedEyeVolume = lerp(smoothedEyeVolume, targetEyeVolume, smoothing);

  if (audio) {
    const now = audio.context.currentTime;
    audio.mouthGain.gain.setTargetAtTime(smoothedMouthVolume * 0.16, now, 0.035);
    audio.eyeGain.gain.setTargetAtTime(smoothedEyeVolume * 0.12, now, 0.035);
  }

  updateMeters(smoothedMouthOpen, smoothedEyeOpen, smoothedMouthVolume, smoothedEyeVolume);
}

function createAudio() {
  const context = new AudioContext();
  const mouthOsc = new OscillatorNode(context, { frequency: 880, type: "square" });
  const eyeOsc = new OscillatorNode(context, { frequency: 2000, type: "sine" });
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

function lerp(from, to, amount) {
  return from + (to - from) * amount;
}

function setStatus(message) {
  statusEl.textContent = message;
}
