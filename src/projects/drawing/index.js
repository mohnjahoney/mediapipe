import { HAND_JOINTS } from "../../gesture-kit/index.js";
import { getResolutionPreset, startCamera, stopCamera } from "../../core/camera.js";
import { createHandTracker } from "../../media/hand-tracker.js";
import { createMedianHandSmoother } from "../ariadne/median-hand-smoother.js";
import { createOverlay } from "../../visuals/overlay.js";

const MAX_BRUSH_RADIUS = 400;
const BRUSH_BASE_THRESHOLD = 0.025;
const BRUSH_DISTANCE_RANGE = 0.24;
const MIN_Z_SIZE_SCALE = 0.6;
const MAX_Z_SIZE_SCALE = 2.4;
const Z_SIZE_SCALE_FACTOR = 10;
const FINGER_COLOR_EXTENSION_MIN = 0.5;
const FINGER_COLOR_EXTENSION_MAX = 1;
const THUMB_RED_EXTENSION_MAX = 0.65;
const CALIBRATION_SAMPLE_COUNT = 18;

const PALETTE_COLORS = [
  "#ff3b30",
  "#ffcc00",
  "#34c759",
  "#007aff",
  "#af52de",
  "#ffffff",
  "#111111",
];

const HAND_COLOR_CONTROLS = {
  red: {
    tip: HAND_JOINTS.thumbTip,
    reference: HAND_JOINTS.thumbMcp,
    insideReference: HAND_JOINTS.indexFingerMcp,
    chain: [HAND_JOINTS.thumbMcp, HAND_JOINTS.thumbIp, HAND_JOINTS.thumbTip],
  },
  green: {
    tip: HAND_JOINTS.indexFingerTip,
    reference: HAND_JOINTS.indexFingerPip,
    chain: [HAND_JOINTS.indexFingerPip, HAND_JOINTS.indexFingerDip, HAND_JOINTS.indexFingerTip],
  },
  blue: {
    tip: HAND_JOINTS.middleFingerTip,
    reference: HAND_JOINTS.middleFingerPip,
    chain: [HAND_JOINTS.middleFingerPip, HAND_JOINTS.middleFingerDip, HAND_JOINTS.middleFingerTip],
  },
  alpha: {
    tip: HAND_JOINTS.pinkyTip,
    reference: HAND_JOINTS.pinkyPip,
    chain: [HAND_JOINTS.pinkyPip, HAND_JOINTS.pinkyDip, HAND_JOINTS.pinkyTip],
  },
};

const DEFAULT_HAND_COLOR_RANGES = {
  alpha: { min: FINGER_COLOR_EXTENSION_MIN, max: FINGER_COLOR_EXTENSION_MAX },
  blue: { min: FINGER_COLOR_EXTENSION_MIN, max: FINGER_COLOR_EXTENSION_MAX },
  green: { min: FINGER_COLOR_EXTENSION_MIN, max: FINGER_COLOR_EXTENSION_MAX },
  red: { min: 0, max: THUMB_RED_EXTENSION_MAX },
};

const HAND_COLOR_MEASUREMENTS = {
  alpha: { type: "fingerExtension", control: HAND_COLOR_CONTROLS.alpha },
  blue: { type: "fingerExtension", control: HAND_COLOR_CONTROLS.blue },
  green: { type: "fingerExtension", control: HAND_COLOR_CONTROLS.green },
  red: { type: "thumbHorizontalExtension", control: HAND_COLOR_CONTROLS.red },
};

const HAND_COLOR_CALIBRATION_STEPS = [
  {
    id: "zero",
    label: "RGBA Zero Pose",
    instruction: "Left hand: thumb inward, index/middle/pinky halfway curled.",
    useAs: "min",
  },
  {
    id: "open",
    label: "Fully Open Hand",
    instruction: "Left hand: open fingers and thumb as far as comfortable.",
    useAs: "max",
  },
];

export function createDrawingProject({ video, canvas }) {
  const overlay = createOverlay(canvas);
  const stage = canvas.closest(".stage");
  const drawingCanvas = document.createElement("canvas");
  const drawingCtx = drawingCanvas.getContext("2d");
  const controls = document.querySelector(".controls");
  const loading = document.querySelector("#loading");
  const handSmoother = createMedianHandSmoother({ windowSize: 5 });
  const panel = createDrawingPanel(stage);

  let handTracker;
  let stream;
  let animationFrameId = 0;
  let paletteMode = panel.paletteMode;
  let currentColor = PALETTE_COLORS[3];
  let isDrawing = false;
  let lastDrawPoint = null;
  let handColorRanges = cloneColorRanges(DEFAULT_HAND_COLOR_RANGES);
  let calibration = null;

  drawingCanvas.className = "drawing-canvas";
  stage.append(drawingCanvas);
  panel.setColor(currentColor);

  return {
    async start() {
      document.body.classList.add("project-drawing");
      controls.hidden = true;
      panel.element.hidden = false;
      panel.element.addEventListener("change", handlePanelChange);
      panel.clearButton.addEventListener("click", clearDrawing);
      panel.calibrateButton.addEventListener("click", handleCalibrationButton);
      loading.textContent = "Loading Drawing...";

      try {
        handTracker = await createHandTracker({ delegate: "CPU" });
        stream = await startCamera(video, getResolutionPreset("full"));
        loading.hidden = true;
        runFrame();
      } catch (error) {
        loading.textContent = error.message;
      }
    },

    stop() {
      cancelAnimationFrame(animationFrameId);
      animationFrameId = 0;
      handTracker?.close();
      handTracker = null;
      stopCamera(stream, video);
      stream = null;
      panel.element.removeEventListener("change", handlePanelChange);
      panel.clearButton.removeEventListener("click", clearDrawing);
      panel.calibrateButton.removeEventListener("click", handleCalibrationButton);
      panel.element.remove();
      drawingCanvas.remove();
      overlay.clear();
    },
  };

  function runFrame() {
    if (!handTracker || !stream) {
      animationFrameId = requestAnimationFrame(runFrame);
      return;
    }

    overlay.resizeToVideo(video);
    resizeDrawingCanvas();
    overlay.clear();

    const rawHands = handTracker.detectHands(video);
    const hands = smoothHands(rawHands);
    const leftHand = hands.find((hand) => hand.handedness === "Left");
    const rightHand = hands.find((hand) => hand.handedness === "Right");

    overlay.drawHands(hands.map((hand) => hand.landmarks));

    updateCalibration(leftHand?.landmarks);
    const isPickingColor = updateColor(leftHand?.landmarks, rightHand?.landmarks);
    updateDrawing(rightHand?.landmarks, isPickingColor);

    animationFrameId = requestAnimationFrame(runFrame);
  }

  function smoothHands(rawHands) {
    const smoothedLandmarks = handSmoother.update(rawHands.map((hand) => hand.landmarks));

    return rawHands.map((hand, index) => ({
      ...hand,
      landmarks: smoothedLandmarks[index] ?? hand.landmarks,
    }));
  }

  function updateDrawing(rightHandLandmarks, isPickingColor) {
    if (!rightHandLandmarks || isPickingColor) {
      endStroke();
      return;
    }

    const brush = measureBrush(rightHandLandmarks);
    const drawPoint = rightHandLandmarks[HAND_JOINTS.indexFingerTip];

    panel.setRadius(brush.radius);
    drawBrushPreview(drawPoint, brush.radius);

    if (!drawPoint || brush.radius <= 0) {
      endStroke();
      return;
    }

    drawStroke(drawPoint, brush.radius);
  }

  function updateColor(leftHandLandmarks, rightHandLandmarks) {
    if (paletteMode === "hand") {
      if (leftHandLandmarks) {
        const handColor = colorFromHand(leftHandLandmarks);
        currentColor = handColor.css;
        panel.setColor(currentColor);
        panel.setColorValues(handColor);
        drawHandColorControls(leftHandLandmarks, handColor);
      }

      return false;
    }

    panel.setColorValues(null);

    const swatches = leftHandLandmarks && isPaletteHandOpen(leftHandLandmarks)
      ? drawPalette(leftHandLandmarks)
      : [];
    const selectedColor = rightHandLandmarks ? hitTestPalette(rightHandLandmarks, swatches) : null;

    if (selectedColor) {
      currentColor = selectedColor;
      panel.setColor(currentColor);
      endStroke();
    }

    return Boolean(selectedColor);
  }

  function measureBrush(landmarks) {
    const thumb = landmarks[HAND_JOINTS.thumbTip];
    const middle = landmarks[HAND_JOINTS.middleFingerTip];

    if (!thumb || !middle) return { radius: 0 };

    const point = midpoint(thumb, middle);
    const scale = zSizeScale(point);
    const threshold = BRUSH_BASE_THRESHOLD * scale;
    const maxDistance = threshold + BRUSH_DISTANCE_RANGE * scale;
    const distance = normalizedDistance(thumb, middle);
    const radius = mapRange(distance, threshold, maxDistance, 0, MAX_BRUSH_RADIUS);

    return {
      distance,
      radius: clamp(radius, 0, MAX_BRUSH_RADIUS),
      threshold,
    };
  }

  function drawStroke(point, radius) {
    const x = point.x * drawingCanvas.width;
    const y = point.y * drawingCanvas.height;

    drawingCtx.lineCap = "round";
    drawingCtx.lineJoin = "round";
    drawingCtx.strokeStyle = currentColor;
    drawingCtx.lineWidth = radius * 2;

    if (!isDrawing || !lastDrawPoint) {
      isDrawing = true;
      lastDrawPoint = { x, y };
      drawingCtx.beginPath();
      drawingCtx.moveTo(x, y);
      drawingCtx.lineTo(x + 0.01, y + 0.01);
      drawingCtx.stroke();
      return;
    }

    drawingCtx.beginPath();
    drawingCtx.moveTo(lastDrawPoint.x, lastDrawPoint.y);
    drawingCtx.lineTo(x, y);
    drawingCtx.stroke();
    lastDrawPoint = { x, y };
  }

  function drawBrushPreview(point, radius) {
    if (!point || radius <= 0) return;

    overlay.drawCircle(point, {
      color: currentColor,
      lineWidth: 3,
      opacity: 0.75,
      radius,
    });
  }

  function drawPalette(landmarks) {
    const swatches = paletteSwatches(landmarks);

    for (const swatch of swatches) {
      overlay.drawPoint(swatch.point, { color: swatch.color, radius: swatch.radiusPx });
      if (swatch.color === currentColor) {
        overlay.drawCircle(swatch.point, {
          color: "#ffffff",
          lineWidth: 3,
          opacity: 0.95,
          radius: swatch.radiusPx + 5,
        });
      }
    }

    return swatches;
  }

  function colorFromHand(landmarks) {
    const raw = handColorMeasurements(landmarks);
    const red = calibratedSignal(raw.red, handColorRanges.red);
    const green = calibratedSignal(raw.green, handColorRanges.green);
    const blue = calibratedSignal(raw.blue, handColorRanges.blue);
    const alpha = calibratedSignal(raw.alpha, handColorRanges.alpha);
    const rgba = {
      alpha,
      blue: Math.round(blue * 255),
      green: Math.round(green * 255),
      red: Math.round(red * 255),
    };

    return {
      ...rgba,
      css: `rgba(${rgba.red}, ${rgba.green}, ${rgba.blue}, ${alpha.toFixed(2)})`,
    };
  }

  function drawHandColorControls(landmarks, color) {
    drawFingerControl(landmarks, HAND_COLOR_CONTROLS.red, `rgba(255, 59, 48, ${0.25 + color.red / 510})`);
    drawFingerControl(landmarks, HAND_COLOR_CONTROLS.green, `rgba(52, 199, 89, ${0.25 + color.green / 510})`);
    drawFingerControl(landmarks, HAND_COLOR_CONTROLS.blue, `rgba(0, 122, 255, ${0.25 + color.blue / 510})`);
    drawFingerControl(landmarks, HAND_COLOR_CONTROLS.alpha, `rgba(255, 255, 255, ${0.25 + color.alpha * 0.5})`);
  }

  function drawFingerControl(landmarks, control, color) {
    const tip = landmarks[control.tip];
    const reference = landmarks[control.reference];

    if (!tip || !reference) return;

    overlay.drawLine(reference, tip, { color, lineWidth: 5 });
    overlay.drawPoint(tip, { color, radius: 8 });
  }

  function paletteSwatches(landmarks) {
    const center = palmCenter(landmarks);
    const scale = handScale(landmarks);
    const radius = Math.max(14, overlay.normalizedRadius(scale * 0.16));
    const offsets = [
      [-0.42, -0.2],
      [-0.14, -0.34],
      [0.14, -0.34],
      [0.42, -0.2],
      [-0.28, 0.12],
      [0, 0.18],
      [0.28, 0.12],
    ];

    return PALETTE_COLORS.map((color, index) => ({
      color,
      point: {
        x: center.x + offsets[index][0] * scale,
        y: center.y + offsets[index][1] * scale,
        z: center.z,
      },
      radiusNorm: scale * 0.16,
      radiusPx: radius,
    }));
  }

  function hitTestPalette(rightHandLandmarks, swatches) {
    const pointer = rightHandLandmarks[HAND_JOINTS.indexFingerTip];

    if (!pointer) return null;

    const hit = swatches.find((swatch) => normalizedDistance(pointer, swatch.point) <= swatch.radiusNorm);
    return hit?.color ?? null;
  }

  function isPaletteHandOpen(landmarks) {
    const scale = handScale(landmarks);
    const indexTip = landmarks[HAND_JOINTS.indexFingerTip];
    const middleTip = landmarks[HAND_JOINTS.middleFingerTip];
    const ringTip = landmarks[HAND_JOINTS.ringFingerTip];
    const pinkyTip = landmarks[HAND_JOINTS.pinkyTip];

    if (!indexTip || !middleTip || !ringTip || !pinkyTip || scale <= 0) return false;

    return (
      normalizedDistance(indexTip, pinkyTip) > scale * 1.05 &&
      normalizedDistance(indexTip, middleTip) > scale * 0.22 &&
      normalizedDistance(middleTip, ringTip) > scale * 0.18 &&
      normalizedDistance(ringTip, pinkyTip) > scale * 0.18
    );
  }

  function palmCenter(landmarks) {
    return averagePoints([
      landmarks[HAND_JOINTS.wrist],
      landmarks[HAND_JOINTS.indexFingerMcp],
      landmarks[HAND_JOINTS.middleFingerMcp],
      landmarks[HAND_JOINTS.ringFingerMcp],
      landmarks[HAND_JOINTS.pinkyMcp],
    ]);
  }

  function handScale(landmarks) {
    const indexMcp = landmarks[HAND_JOINTS.indexFingerMcp];
    const pinkyMcp = landmarks[HAND_JOINTS.pinkyMcp];
    const wrist = landmarks[HAND_JOINTS.wrist];
    const middleMcp = landmarks[HAND_JOINTS.middleFingerMcp];

    if (indexMcp && pinkyMcp) return normalizedDistance(indexMcp, pinkyMcp);
    if (wrist && middleMcp) return normalizedDistance(wrist, middleMcp);

    return 0.2;
  }

  function resizeDrawingCanvas() {
    if (drawingCanvas.width !== canvas.width || drawingCanvas.height !== canvas.height) {
      const previous = document.createElement("canvas");
      previous.width = drawingCanvas.width;
      previous.height = drawingCanvas.height;
      previous.getContext("2d").drawImage(drawingCanvas, 0, 0);

      drawingCanvas.width = canvas.width;
      drawingCanvas.height = canvas.height;
      drawingCtx.drawImage(previous, 0, 0, drawingCanvas.width, drawingCanvas.height);
    }
  }

  function clearDrawing() {
    drawingCtx.clearRect(0, 0, drawingCanvas.width, drawingCanvas.height);
    endStroke();
  }

  function handleCalibrationButton() {
    if (!calibration) {
      startCalibration();
      return;
    }

    if (calibration.isCapturing) return;

    calibration.isCapturing = true;
    calibration.samples = [];
    panel.calibrateButton.disabled = true;
  }

  function startCalibration() {
    const step = HAND_COLOR_CALIBRATION_STEPS[0];

    calibration = {
      isCapturing: false,
      samples: [],
      stepIndex: 0,
      values: cloneColorRanges(DEFAULT_HAND_COLOR_RANGES),
    };
    panel.setCalibrationStatus(calibrationMessage());
    panel.calibrateButton.textContent = `Capture ${step.label}`;
  }

  function updateCalibration(leftHandLandmarks) {
    if (!calibration) return;

    const step = HAND_COLOR_CALIBRATION_STEPS[calibration.stepIndex];

    if (!calibration.isCapturing) return;

    if (!leftHandLandmarks) {
      panel.setCalibrationStatus(`${step.label}: show your left hand.`);
      calibration.isCapturing = false;
      calibration.samples = [];
      panel.calibrateButton.disabled = false;
      return;
    }

    calibration.samples.push(handColorMeasurements(leftHandLandmarks));
    panel.setCalibrationStatus(`${step.label}: ${calibration.samples.length}/${CALIBRATION_SAMPLE_COUNT} samples`);

    if (calibration.samples.length < CALIBRATION_SAMPLE_COUNT) return;

    const sample = averageCalibrationSamples(calibration.samples);
    for (const channel of Object.keys(DEFAULT_HAND_COLOR_RANGES)) {
      calibration.values[channel][step.useAs] = sample[channel];
    }

    calibration.stepIndex += 1;
    calibration.samples = [];

    if (calibration.stepIndex < HAND_COLOR_CALIBRATION_STEPS.length) {
      const nextStep = HAND_COLOR_CALIBRATION_STEPS[calibration.stepIndex];
      calibration.isCapturing = false;
      panel.calibrateButton.disabled = false;
      panel.calibrateButton.textContent = `Capture ${nextStep.label}`;
      panel.setCalibrationStatus(calibrationMessage());
      return;
    }

    handColorRanges = normalizeCalibrationRanges(calibration.values);
    calibration = null;
    panel.calibrateButton.disabled = false;
    panel.calibrateButton.textContent = "Calibrate Hand";
    panel.setCalibrationStatus("Calibration saved.");
  }

  function calibrationMessage() {
    const step = HAND_COLOR_CALIBRATION_STEPS[calibration.stepIndex];
    return `${step.label}: ${step.instruction}`;
  }

  function endStroke() {
    isDrawing = false;
    lastDrawPoint = null;
  }

  function handlePanelChange() {
    paletteMode = panel.paletteMode;
    endStroke();
  }
}

function createDrawingPanel(stage) {
  const element = document.createElement("div");
  const paletteSelect = document.createElement("select");
  const colorSwatch = document.createElement("span");
  const radiusValue = document.createElement("span");
  const colorValues = document.createElement("span");
  const calibrationStatus = document.createElement("span");
  const calibrateButton = document.createElement("button");
  const clearButton = document.createElement("button");

  element.className = "drawing-control";
  element.hidden = true;
  paletteSelect.innerHTML = `
    <option value="swatches">Swatches</option>
    <option value="hand">Hand RGBA</option>
  `;
  colorSwatch.className = "drawing-current-color";
  colorValues.className = "drawing-color-values";
  colorValues.textContent = "Swatches";
  calibrationStatus.className = "drawing-calibration-status";
  calibrationStatus.textContent = "Calibration: default";
  radiusValue.textContent = "Radius 0";
  calibrateButton.type = "button";
  calibrateButton.textContent = "Calibrate Hand";
  clearButton.type = "button";
  clearButton.textContent = "Clear Screen";
  element.append(
    "Palette",
    paletteSelect,
    "Color",
    colorSwatch,
    colorValues,
    radiusValue,
    calibrationStatus,
    calibrateButton,
    clearButton
  );
  stage.append(element);

  return {
    calibrateButton,
    clearButton,
    element,
    get paletteMode() {
      return paletteSelect.value;
    },
    setColor(color) {
      colorSwatch.style.background = color;
    },
    setColorValues(color) {
      colorValues.textContent = color
        ? `R ${color.red}  G ${color.green}  B ${color.blue}  A ${color.alpha.toFixed(2)}`
        : "Swatches";
    },
    setCalibrationStatus(message) {
      calibrationStatus.textContent = message;
    },
    setRadius(radius) {
      radiusValue.textContent = `Radius ${Math.round(radius)}`;
    },
  };
}

function averagePoints(points) {
  const validPoints = points.filter(Boolean);

  if (validPoints.length === 0) {
    return { x: 0.5, y: 0.5, z: 0 };
  }

  const total = validPoints.reduce(
    (sum, point) => ({
      x: sum.x + point.x,
      y: sum.y + point.y,
      z: sum.z + (point.z ?? 0),
    }),
    { x: 0, y: 0, z: 0 }
  );

  return {
    x: total.x / validPoints.length,
    y: total.y / validPoints.length,
    z: total.z / validPoints.length,
  };
}

function midpoint(a, b) {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: ((a.z ?? 0) + (b.z ?? 0)) / 2,
  };
}

function handColorMeasurements(landmarks) {
  return Object.fromEntries(
    Object.entries(HAND_COLOR_MEASUREMENTS).map(([channel, measurement]) => [
      channel,
      evaluateHandMeasurement(landmarks, measurement),
    ])
  );
}

function evaluateHandMeasurement(landmarks, measurement) {
  if (measurement.type === "fingerExtension") {
    return rawFingerExtension(landmarks, measurement.control);
  }

  if (measurement.type === "thumbHorizontalExtension") {
    return rawThumbHorizontalExtension(landmarks, measurement.control);
  }

  return 0;
}

function rawFingerExtension(landmarks, control) {
  const wrist = landmarks[HAND_JOINTS.wrist];
  const tip = landmarks[control.tip];
  const reference = landmarks[control.reference];
  const chainLength = fingerChainLength(landmarks, control.chain);

  if (!wrist || !tip || !reference || chainLength <= 0) return 0;

  const extension = normalizedDistance(wrist, tip) - normalizedDistance(wrist, reference);

  return clamp(extension / chainLength, 0, 1);
}

function rawThumbHorizontalExtension(landmarks, control) {
  const tip = landmarks[control.tip];
  const reference = landmarks[control.reference];
  const insideReference = landmarks[control.insideReference];
  const chainLength = fingerChainLength(landmarks, control.chain);

  if (!tip || !reference || !insideReference || chainLength <= 0) return 0;

  const insideDirection = Math.sign(insideReference.x - reference.x);
  const outwardDirection = insideDirection === 0 ? 1 : -insideDirection;
  const horizontalExtension = (tip.x - reference.x) * outwardDirection;

  return clamp(horizontalExtension / chainLength, 0, 1);
}

function calibratedSignal(value, range) {
  return mapRangeClamped(value, range.min, range.max, 0, 1);
}

function averageCalibrationSamples(samples) {
  const total = samples.reduce(
    (sum, sample) => ({
      alpha: sum.alpha + sample.alpha,
      blue: sum.blue + sample.blue,
      green: sum.green + sample.green,
      red: sum.red + sample.red,
    }),
    { alpha: 0, blue: 0, green: 0, red: 0 }
  );

  return {
    alpha: total.alpha / samples.length,
    blue: total.blue / samples.length,
    green: total.green / samples.length,
    red: total.red / samples.length,
  };
}

function normalizeCalibrationRanges(ranges) {
  const normalized = cloneColorRanges(ranges);

  for (const channel of Object.keys(normalized)) {
    const range = normalized[channel];
    if (range.max < range.min) {
      const previousMin = range.min;
      range.min = range.max;
      range.max = previousMin;
    }

    if (range.max - range.min < 0.05) {
      range.max = clamp(range.min + 0.05, 0.05, 1);
    }
  }

  return normalized;
}

function cloneColorRanges(ranges) {
  return Object.fromEntries(
    Object.entries(ranges).map(([channel, range]) => [channel, { min: range.min, max: range.max }])
  );
}

function fingerChainLength(landmarks, joints) {
  let total = 0;

  for (let index = 1; index < joints.length; index += 1) {
    const previous = landmarks[joints[index - 1]];
    const next = landmarks[joints[index]];

    if (!previous || !next) return 0;

    total += normalizedDistance(previous, next);
  }

  return total;
}

function normalizedDistance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function zSizeScale(point) {
  return clamp(1 - (point.z ?? 0) * Z_SIZE_SCALE_FACTOR, MIN_Z_SIZE_SCALE, MAX_Z_SIZE_SCALE);
}

function mapRange(value, inMin, inMax, outMin, outMax) {
  if (inMax === inMin) return outMin;

  return outMin + ((value - inMin) / (inMax - inMin)) * (outMax - outMin);
}

function mapRangeClamped(value, inMin, inMax, outMin, outMax) {
  return clamp(mapRange(value, inMin, inMax, outMin, outMax), Math.min(outMin, outMax), Math.max(outMin, outMax));
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
