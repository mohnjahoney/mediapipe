import { getResolutionPreset, startCamera, stopCamera } from "../../core/camera.js";
import { createHandTracker } from "../../media/hand-tracker.js";
import { createOverlay } from "../../visuals/overlay.js";
import { compileJointPair } from "../../gesture-kit/hand-joints.js";
import { createMedianHandSmoother } from "./median-hand-smoother.js";
import { createThreeContactRenderer } from "./three-contact-renderer.js";

const thumbMiddleContactJoints = compileJointPair({
  from: "thumbTip",
  to: "middleFingerTip",
});
const thumbToMiddleBaseThreshold = 0.06;
const BASE_CONTACT_POINT_RADIUS = 7;
const MIN_CONTACT_POINT_RADIUS = 4;
const MAX_CONTACT_POINT_RADIUS = 16;
const MIN_Z_SIZE_SCALE = 0.6;
const MAX_Z_SIZE_SCALE = 2.4;
const Z_SIZE_SCALE_FACTOR = 10;

export function createAriadneProject({ video, canvas }) {
  const overlay = createOverlay(canvas);
  const handSmoother = createMedianHandSmoother({ windowSize: 5 });
  const stage = canvas.closest(".stage");
  const renderControl = createRenderControl(stage);
  const threeContactRenderer = createThreeContactRenderer({
    stage,
    video,
    radiusForPoint: contactPointRadius,
  });
  const loading = document.querySelector("#loading");
  const controls = document.querySelector(".controls");
  let renderMode = renderControl.value;
  let materialMode = renderControl.materialMode;
  let handTracker;
  let stream;
  let animationFrameId = 0;
  let thumbMiddleContactPoint = null;
  let thumbMiddleInitialContactPoint = null;
  let thumbMiddleFinalContactPoint = null;
  const thumbMiddleContactSegments = [];

  return {
    async start() {
      document.body.classList.add("project-ariadne");
      controls.hidden = true;
      renderControl.element.hidden = false;
      renderControl.element.addEventListener("change", handleRenderModeChange);
      loading.textContent = "Loading Ariadne...";

      try {
        handTracker = await createHandTracker();
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
      stopCamera(stream, video);
      stream = null;
      thumbMiddleContactPoint = null;
      thumbMiddleInitialContactPoint = null;
      thumbMiddleFinalContactPoint = null;
      thumbMiddleContactSegments.length = 0;
      handSmoother.reset();
      renderControl.element.removeEventListener("change", handleRenderModeChange);
      renderControl.element.remove();
      threeContactRenderer.dispose();
      overlay.clear();
    },
  };

  function runFrame() {
    if (!handTracker || !stream) return;

    overlay.resizeToVideo(video);
    overlay.clear();

    const rawHands = handTracker.detect(video);
    const hands = handSmoother.update(rawHands);
    updateThumbMiddleContactPoint(hands);
    overlay.drawHands(hands);
    drawThumbMiddleEndpointGuides(hands);
    renderContactVisuals();

    animationFrameId = requestAnimationFrame(runFrame);
  }

  function drawThumbMiddleEndpointGuides(hands) {
    for (const landmarks of hands) {
      const thumb = landmarks[thumbMiddleContactJoints.fromIndex];
      const middle = landmarks[thumbMiddleContactJoints.toIndex];

      if (!thumb || !middle) continue;

      const thumbMiddleThreshold = contactThreshold(midpoint(thumb, middle));
      const radius = overlay.normalizedRadius(thumbMiddleThreshold / 2);
      const isContacting = distance(thumb, middle) < thumbMiddleThreshold;
      const opacity = isContacting ? 0.6 : 0.2;

      overlay.drawCircle(thumb, { color: "#ffe45c", opacity, radius });
      overlay.drawCircle(middle, { color: "#ffe45c", opacity, radius });
    }
  }

  function drawThumbMiddleContactSegmentLines() {
    for (const segment of thumbMiddleContactSegments) {
      drawThumbMiddleContactLine(segment.initial, segment.final);
    }
  }

  function drawThumbMiddleLiveContactLine() {
    if (!thumbMiddleInitialContactPoint || !thumbMiddleContactPoint) return;

    drawThumbMiddleContactLine(thumbMiddleInitialContactPoint, thumbMiddleContactPoint);
  }

  function drawThumbMiddleContactLine(start, end) {
    overlay.drawTaperedLine(start, end, {
      color: "#ffffff",
      startWidth: contactPointRadius(start),
      endWidth: contactPointRadius(end),
    });
  }

  function drawThumbMiddleContactDots() {
    for (const segment of thumbMiddleContactSegments) {
      overlay.drawPoint(segment.initial, {
        color: "#26d96c",
        radius: contactPointRadius(segment.initial),
      });
      overlay.drawPoint(segment.final, {
        color: "#ff3333",
        radius: contactPointRadius(segment.final),
      });
    }

    if (thumbMiddleContactPoint && thumbMiddleInitialContactPoint) {
      overlay.drawPoint(thumbMiddleInitialContactPoint, {
        color: "#26d96c",
        radius: contactPointRadius(thumbMiddleInitialContactPoint),
      });
    }
    if (thumbMiddleContactPoint) {
      overlay.drawPoint(thumbMiddleContactPoint, {
        color: "#ffffff",
        radius: contactPointRadius(thumbMiddleContactPoint),
      });
    }
  }

  function renderContactVisuals() {
    const state = {
      segments: thumbMiddleContactSegments,
      initial: thumbMiddleContactPoint ? thumbMiddleInitialContactPoint : null,
      final: null,
      live: thumbMiddleContactPoint,
    };

    if (renderMode === "three") {
      threeContactRenderer.setEnabled(true);
      threeContactRenderer.setMaterialMode(materialMode);
      threeContactRenderer.render(state);
      return;
    }

    threeContactRenderer.setEnabled(false);
    drawThumbMiddleContactSegmentLines();
    drawThumbMiddleLiveContactLine();
    drawThumbMiddleContactDots();
  }

  function updateThumbMiddleContactPoint(hands) {
    const nextContactPoint = getThumbMiddleContactPoint(hands);

    if (nextContactPoint && !thumbMiddleContactPoint) {
      thumbMiddleInitialContactPoint = nextContactPoint;
      thumbMiddleFinalContactPoint = null;
    } else if (!nextContactPoint && thumbMiddleContactPoint) {
      thumbMiddleFinalContactPoint = thumbMiddleContactPoint;
      thumbMiddleContactSegments.push({
        initial: thumbMiddleInitialContactPoint,
        final: thumbMiddleFinalContactPoint,
      });
    }

    thumbMiddleContactPoint = nextContactPoint;
  }

  function handleRenderModeChange() {
    renderMode = renderControl.value;
    materialMode = renderControl.materialMode;
  }
}

function createRenderControl(stage) {
  const label = document.createElement("label");
  const renderSelect = document.createElement("select");
  const materialSelect = document.createElement("select");

  label.className = "ariadne-render-control";
  label.hidden = true;

  const renderText = document.createElement("span");
  renderText.textContent = "Render";
  renderSelect.innerHTML = `
    <option value="canvas">2D Canvas</option>
    <option value="three">3D Three.js</option>
  `;

  const materialText = document.createElement("span");
  materialText.textContent = "3D material";
  materialSelect.innerHTML = `
    <option value="basic">Basic</option>
    <option value="lambert">Lambert</option>
  `;

  label.append(renderText, renderSelect, materialText, materialSelect);
  stage.append(label);

  return {
    element: label,
    get value() {
      return renderSelect.value;
    },
    get materialMode() {
      return materialSelect.value;
    },
  };
}

function getThumbMiddleContactPoint(hands) {
  let closestContact = null;
  let closestDistance = Infinity;

  for (const landmarks of hands) {
    const thumb = landmarks[thumbMiddleContactJoints.fromIndex];
    const middle = landmarks[thumbMiddleContactJoints.toIndex];

    if (!thumb || !middle) continue;

    const thumbMiddleDistance = distance(thumb, middle);
    const thumbMiddleThreshold = contactThreshold(midpoint(thumb, middle));

    if (thumbMiddleDistance < thumbMiddleThreshold && thumbMiddleDistance < closestDistance) {
      closestDistance = thumbMiddleDistance;
      closestContact = midpoint(thumb, middle);
    }
  }

  return closestContact;
}

function distance(a, b) {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function midpoint(a, b) {
  return {
    x: (a.x + b.x) / 2,
    y: (a.y + b.y) / 2,
    z: ((a.z ?? 0) + (b.z ?? 0)) / 2,
  };
}

function contactThreshold(point) {
  return thumbToMiddleBaseThreshold * zSizeScale(point);
}

function contactPointRadius(point) {
  const radius = BASE_CONTACT_POINT_RADIUS * zSizeScale(point);

  return clamp(radius, MIN_CONTACT_POINT_RADIUS, MAX_CONTACT_POINT_RADIUS);
}

function zSizeScale(point) {
  return clamp(1 - (point.z ?? 0) * Z_SIZE_SCALE_FACTOR, MIN_Z_SIZE_SCALE, MAX_Z_SIZE_SCALE);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}
