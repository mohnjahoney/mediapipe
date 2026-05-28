import { HAND_JOINTS } from "../../gesture-kit/index.js";
import { getResolutionPreset, startCamera, stopCamera } from "../../core/camera.js";
import { createHandTracker } from "../../media/hand-tracker.js";
import { createMedianHandSmoother } from "../ariadne/median-hand-smoother.js";
import { createOverlay } from "../../visuals/overlay.js";

const MAX_BRUSH_RADIUS = 100;
const BRUSH_BASE_THRESHOLD = 0.06;
const BRUSH_DISTANCE_RANGE = 0.22;
const MIN_Z_SIZE_SCALE = 0.6;
const MAX_Z_SIZE_SCALE = 2.4;
const Z_SIZE_SCALE_FACTOR = 10;

const PALETTE_COLORS = [
  "#ff3b30",
  "#ffcc00",
  "#34c759",
  "#007aff",
  "#af52de",
  "#ffffff",
  "#111111",
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
  let currentColor = PALETTE_COLORS[3];
  let isDrawing = false;
  let lastDrawPoint = null;

  drawingCanvas.className = "drawing-canvas";
  stage.append(drawingCanvas);
  panel.setColor(currentColor);

  return {
    async start() {
      document.body.classList.add("project-drawing");
      controls.hidden = true;
      panel.element.hidden = false;
      panel.clearButton.addEventListener("click", clearDrawing);
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
      panel.clearButton.removeEventListener("click", clearDrawing);
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

    const swatches = leftHand && isPaletteHandOpen(leftHand.landmarks)
      ? drawPalette(leftHand.landmarks)
      : [];

    const selectedColor = rightHand ? hitTestPalette(rightHand.landmarks, swatches) : null;
    if (selectedColor) {
      currentColor = selectedColor;
      panel.setColor(currentColor);
      endStroke();
    }

    updateDrawing(rightHand?.landmarks, Boolean(selectedColor));

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

  function endStroke() {
    isDrawing = false;
    lastDrawPoint = null;
  }
}

function createDrawingPanel(stage) {
  const element = document.createElement("div");
  const colorSwatch = document.createElement("span");
  const radiusValue = document.createElement("span");
  const clearButton = document.createElement("button");

  element.className = "drawing-control";
  element.hidden = true;
  colorSwatch.className = "drawing-current-color";
  radiusValue.textContent = "Radius 0";
  clearButton.type = "button";
  clearButton.textContent = "Clear Screen";
  element.append("Color", colorSwatch, radiusValue, clearButton);
  stage.append(element);

  return {
    clearButton,
    element,
    setColor(color) {
      colorSwatch.style.background = color;
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

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
