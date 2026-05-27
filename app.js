import { startCamera, stopCamera } from "./src/core/camera.js";
import { createSignalDelay } from "./src/core/signal-delay.js";
import { createFaceTracker } from "./src/media/face-tracker.js";
import { measureFaceSignals } from "./src/signals/face-signals.js";
import { createRedPixelSampler } from "./src/signals/pixel-signals.js";
import { createAudioEngine } from "./src/audio/audio-engine.js";
import { createOverlay } from "./src/visuals/overlay.js";
import { createUI } from "./src/ui/ui.js";

const video = document.querySelector("#video");
const canvas = document.querySelector("#overlay");
const ui = createUI();
const overlay = createOverlay(canvas);
const signalDelay = createSignalDelay();
const redPixelSampler = createRedPixelSampler();

let faceTracker;
let stream;
let animationFrameId = 0;
let audio;

ui.onStart(start);
ui.onStop(stop);
ui.onFrequencyChange(() => {
  ui.updateFrequencyLabels();
  audio?.setFrequencies(ui.getSettings());
});
ui.onDelayChange(() => ui.updateDelayLabel());
ui.onRedDecisionChange(() => ui.updateRedDecisionLabel());
ui.onOverlayChange(() => {
  if (!ui.getSettings().showOverlay) overlay.clear();
});
ui.onResolutionChange(() => ui.updateResolutionLabel());

ui.updateFrequencyLabels();
ui.updateRedDecisionLabel();
ui.updateDelayLabel();
ui.updateResolutionLabel();
initMediaPipe();

async function initMediaPipe() {
  try {
    faceTracker = await createFaceTracker();
    ui.setReady();
  } catch (error) {
    ui.setLoadFailed(error.message);
  }
}

async function start() {
  ui.setStarting();

  try {
    if (!faceTracker) {
      ui.setStartFailed("MediaPipe is still loading. Try again in a moment.");
      return;
    }

    stream = await startCamera(video, ui.getSettings().resolution);
    audio = createAudioEngine(ui.getSettings());
    await audio.start();

    overlay.resizeToVideo(video);
    ui.setRunning();
    runFrame();
  } catch (error) {
    ui.setStartFailed(error.message);
  }
}

function stop() {
  cancelAnimationFrame(animationFrameId);
  animationFrameId = 0;

  audio?.stop();
  audio = null;
  stopCamera(stream, video);
  stream = null;
  signalDelay.clear();
  overlay.clear();
  ui.setStopped();
  ui.updateMeters({
    mouthOpen: 0,
    eyeOpen: 0,
    redPixel: 0,
    mouthVolume: 0,
    eyeVolume: 0,
    redVolume: 0,
  });
}

function runFrame() {
  if (!faceTracker || !stream) return;

  overlay.resizeToVideo(video);
  overlay.clear();

  const settings = ui.getSettings();
  const faceSignals = settings.enableFaceAnalysis
    ? getFaceSignals(settings)
    : { landmarks: null, signals: { mouthOpen: 0, eyeOpen: 1 } };
  const rawSignals = {
    ...faceSignals.signals,
    ...redPixelSampler.sample(video),
  };
  const outputSignals = mapSignalsToVolumes(rawSignals, settings);

  audio?.setVolumes(outputSignals);
  ui.updateMeters({ ...rawSignals, ...outputSignals });

  if (faceSignals.landmarks && settings.showOverlay) {
    overlay.drawFace(faceSignals.landmarks);
  }

  if (!settings.enableFaceAnalysis) {
    ui.setStatus("Facial analysis off.");
  } else if (faceSignals.landmarks) {
    ui.setStatus("Tracking face.");
  } else {
    ui.setStatus("No face detected.");
  }

  overlay.drawSampleBox(redPixelSampler.point);
  animationFrameId = requestAnimationFrame(runFrame);
}

function getFaceSignals(settings) {
  const landmarks = faceTracker.detect(video);

  return {
    landmarks,
    signals: landmarks
      ? measureFaceSignals(landmarks, settings.thresholds)
      : { mouthOpen: 0, eyeOpen: 1 },
  };
}

function mapSignalsToVolumes(rawSignals, settings) {
  signalDelay.push(rawSignals);

  const delayedSignals = signalDelay.get(settings.delaySeconds) ?? rawSignals;
  const mouthVolume = delayedSignals.mouthOpen;
  const eyeVolume = 1 - delayedSignals.eyeOpen;
  const redVolume = delayedSignals.redPixel;

  if (!settings.binaryAudio) {
    return { mouthVolume, eyeVolume, redVolume };
  }

  return {
    mouthVolume: mouthVolume > 0 ? 1 : 0,
    eyeVolume: eyeVolume > 0 ? 1 : 0,
    redVolume: redVolume > settings.redDecision ? 1 : 0,
  };
}
