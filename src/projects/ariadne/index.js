import { getResolutionPreset, startCamera, stopCamera } from "../../core/camera.js";
import { createHandTracker } from "../../media/hand-tracker.js";
import { createOverlay } from "../../visuals/overlay.js";

const THUMB_TIP = 4;
const MIDDLE_TIP = 12;
const thumbToMiddleThreshold = 0.06;

export function createAriadneProject({ video, canvas }) {
  const overlay = createOverlay(canvas);
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
      overlay.clear();
    },
  };

  function runFrame() {
    if (!handTracker || !stream) return;

    overlay.resizeToVideo(video);
    overlay.clear();

    const hands = handTracker.detect(video);
    updateThumbMiddleContactPoint(hands);
    overlay.drawHands(hands);
    drawThumbMiddleEndpointGuides(hands);
    drawThumbMiddleContactSegmentLines();
    drawThumbMiddleContactDots();

    animationFrameId = requestAnimationFrame(runFrame);
  }

  function drawThumbMiddleEndpointGuides(hands) {
    const radius = overlay.normalizedRadius(thumbToMiddleThreshold / 2);

    for (const landmarks of hands) {
      const thumb = landmarks[THUMB_TIP];
      const middle = landmarks[MIDDLE_TIP];

      if (!thumb || !middle) continue;

      const isContacting = distance(thumb, middle) < thumbToMiddleThreshold;
      const opacity = isContacting ? 0.6 : 0.2;

      overlay.drawCircle(thumb, { color: "#ffe45c", opacity, radius });
      overlay.drawCircle(middle, { color: "#ffe45c", opacity, radius });
    }
  }

  function drawThumbMiddleContactSegmentLines() {
    for (const segment of thumbMiddleContactSegments) {
      overlay.drawLine(segment.initial, segment.final, { color: "#ffffff", lineWidth: 3 });
    }
  }

  function drawThumbMiddleContactDots() {
    for (const segment of thumbMiddleContactSegments) {
      overlay.drawPoint(segment.initial, { color: "#26d96c", radius: 7 });
      overlay.drawPoint(segment.final, { color: "#ff3333", radius: 7 });
    }

    if (thumbMiddleInitialContactPoint) {
      overlay.drawPoint(thumbMiddleInitialContactPoint, { color: "#26d96c", radius: 7 });
    }
    if (thumbMiddleFinalContactPoint) {
      overlay.drawPoint(thumbMiddleFinalContactPoint, { color: "#ff3333", radius: 7 });
    }
    if (thumbMiddleContactPoint) {
      overlay.drawPoint(thumbMiddleContactPoint, { color: "#ffffff", radius: 6 });
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

    if (thumbMiddleDistance < thumbToMiddleThreshold && thumbMiddleDistance < closestDistance) {
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
  };
}
