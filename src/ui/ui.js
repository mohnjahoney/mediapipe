import { clamp } from "../signals/signal-utils.js";
import { getResolutionPreset } from "../core/camera.js";

export function createUI() {
  const elements = {
    loading: document.querySelector("#loading"),
    startButton: document.querySelector("#startButton"),
    stopButton: document.querySelector("#stopButton"),
    status: document.querySelector("#status"),
    mouthThreshold: document.querySelector("#mouthThreshold"),
    eyeOpenThreshold: document.querySelector("#eyeOpenThreshold"),
    mouthFrequency: document.querySelector("#mouthFrequency"),
    eyeFrequency: document.querySelector("#eyeFrequency"),
    redFrequency: document.querySelector("#redFrequency"),
    redDecision: document.querySelector("#redDecision"),
    dataDelay: document.querySelector("#dataDelay"),
    mouthFrequencyLabel: document.querySelector("#mouthFrequencyLabel"),
    eyeFrequencyLabel: document.querySelector("#eyeFrequencyLabel"),
    redFrequencyLabel: document.querySelector("#redFrequencyLabel"),
    mouthFrequencyValue: document.querySelector("#mouthFrequencyValue"),
    eyeFrequencyValue: document.querySelector("#eyeFrequencyValue"),
    redFrequencyValue: document.querySelector("#redFrequencyValue"),
    redDecisionValue: document.querySelector("#redDecisionValue"),
    delayValue: document.querySelector("#delayValue"),
    binaryAudio: document.querySelector("#binaryAudio"),
    enableFaceAnalysis: document.querySelector("#enableFaceAnalysis"),
    showOverlay: document.querySelector("#showOverlay"),
    cameraResolution: document.querySelector("#cameraResolution"),
    resolutionValue: document.querySelector("#resolutionValue"),
  };

  const meters = {
    mouthOpen: bindMeter("mouthOpen"),
    eyeOpen: bindMeter("eyeOpen"),
    mouthVolume: bindMeter("mouthVolume"),
    eyeVolume: bindMeter("eyeVolume"),
    redPixel: bindMeter("redPixel"),
    redVolume: bindMeter("redVolume"),
  };

  return {
    onStart(handler) {
      elements.startButton.addEventListener("click", handler);
    },

    onStop(handler) {
      elements.stopButton.addEventListener("click", handler);
    },

    onFrequencyChange(handler) {
      elements.mouthFrequency.addEventListener("input", handler);
      elements.eyeFrequency.addEventListener("input", handler);
      elements.redFrequency.addEventListener("input", handler);
    },

    onRedDecisionChange(handler) {
      elements.redDecision.addEventListener("input", handler);
    },

    onDelayChange(handler) {
      elements.dataDelay.addEventListener("input", handler);
    },

    onOverlayChange(handler) {
      elements.showOverlay.addEventListener("change", handler);
    },

    onResolutionChange(handler) {
      elements.cameraResolution.addEventListener("change", handler);
    },

    getSettings() {
      return {
        thresholds: {
          mouth: Number(elements.mouthThreshold.value),
          eyeOpen: Number(elements.eyeOpenThreshold.value),
        },
        mouthFrequency: Number(elements.mouthFrequency.value),
        eyeFrequency: Number(elements.eyeFrequency.value),
        redFrequency: Number(elements.redFrequency.value),
        redDecision: Number(elements.redDecision.value),
        delaySeconds: Number(elements.dataDelay.value),
        binaryAudio: elements.binaryAudio.checked,
        enableFaceAnalysis: elements.enableFaceAnalysis.checked,
        showOverlay: elements.showOverlay.checked,
        resolution: getResolutionPreset(elements.cameraResolution.value),
      };
    },

    setReady() {
      elements.loading.hidden = true;
      elements.startButton.disabled = false;
      this.setStatus("Ready.");
    },

    setStarting() {
      elements.startButton.disabled = true;
      this.setStatus("Starting camera...");
    },

    setRunning() {
      elements.stopButton.disabled = false;
      this.setStatus("Tracking face.");
    },

    setStopped() {
      elements.startButton.disabled = false;
      elements.stopButton.disabled = true;
      this.setStatus("Stopped.");
    },

    setStartFailed(message) {
      elements.startButton.disabled = false;
      elements.stopButton.disabled = true;
      this.setStatus(message);
    },

    setLoadFailed(message) {
      elements.loading.textContent = "MediaPipe failed to load.";
      this.setStatus(message);
    },

    setStatus(message) {
      elements.status.textContent = message;
    },

    updateFrequencyLabels() {
      const { mouthFrequency, eyeFrequency, redFrequency } = this.getSettings();
      elements.mouthFrequencyLabel.textContent = `${mouthFrequency} Hz`;
      elements.eyeFrequencyLabel.textContent = `${eyeFrequency} Hz`;
      elements.redFrequencyLabel.textContent = `${redFrequency} Hz`;
      elements.mouthFrequencyValue.value = `${mouthFrequency} Hz`;
      elements.eyeFrequencyValue.value = `${eyeFrequency} Hz`;
      elements.redFrequencyValue.value = `${redFrequency} Hz`;
    },

    updateRedDecisionLabel() {
      elements.redDecisionValue.value = this.getSettings().redDecision.toFixed(2);
    },

    updateDelayLabel() {
      elements.delayValue.value = `${this.getSettings().delaySeconds.toFixed(2)} s`;
    },

    updateResolutionLabel() {
      elements.resolutionValue.value = this.getSettings().resolution.label;
    },

    updateMeters({ mouthOpen, eyeOpen, redPixel, mouthVolume, eyeVolume, redVolume }) {
      setMeter(meters.mouthOpen, mouthOpen);
      setMeter(meters.eyeOpen, eyeOpen);
      setMeter(meters.redPixel, redPixel);
      setMeter(meters.mouthVolume, mouthVolume);
      setMeter(meters.eyeVolume, eyeVolume);
      setMeter(meters.redVolume, redVolume);
    },
  };
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
