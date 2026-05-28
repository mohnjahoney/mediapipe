import { getResolutionPreset, startCamera, stopCamera } from "../../core/camera.js";
import { createHandTracker } from "../../media/hand-tracker.js";
import { createOverlay } from "../../visuals/overlay.js";
import { createMedianHandSmoother } from "./median-hand-smoother.js";

const THUMB_TIP = 4;
const MIDDLE_TIP = 12;
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
  const loading = document.querySelector("#loading");
  const controls = document.querySelector(".controls");
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
    drawThumbMiddleContactSegmentLines();
    drawThumbMiddleLiveContactLine();
    drawThumbMiddleContactDots();

    animationFrameId = requestAnimationFrame(runFrame);
  }

  function drawThumbMiddleEndpointGuides(hands) {
    for (const landmarks of hands) {
      const thumb = landmarks[THUMB_TIP];
      const middle = landmarks[MIDDLE_TIP];

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

    if (thumbMiddleInitialContactPoint) {
      overlay.drawPoint(thumbMiddleInitialContactPoint, {
        color: "#26d96c",
        radius: contactPointRadius(thumbMiddleInitialContactPoint),
      });
    }
    if (thumbMiddleFinalContactPoint) {
      overlay.drawPoint(thumbMiddleFinalContactPoint, {
        color: "#ff3333",
        radius: contactPointRadius(thumbMiddleFinalContactPoint),
      });
    }
    if (thumbMiddleContactPoint) {
      overlay.drawPoint(thumbMiddleContactPoint, {
        color: "#ffffff",
        radius: contactPointRadius(thumbMiddleContactPoint),
      });
    }
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
}

function getThumbMiddleContactPoint(hands) {
  let closestContact = null;
  let closestDistance = Infinity;

  for (const landmarks of hands) {
    const thumb = landmarks[THUMB_TIP];
    const middle = landmarks[MIDDLE_TIP];

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
