import { getResolutionPreset, startCamera, stopCamera } from "../../core/camera.js";
import { createHandTracker } from "../../media/hand-tracker.js";
import { createOverlay } from "../../visuals/overlay.js";

export function createAriadneProject({ video, canvas }) {
  const overlay = createOverlay(canvas);
  const loading = document.querySelector("#loading");
  const controls = document.querySelector(".controls");
  let handTracker;
  let stream;
  let animationFrameId = 0;

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
      overlay.clear();
    },
  };

  function runFrame() {
    if (!handTracker || !stream) return;

    overlay.resizeToVideo(video);
    overlay.clear();

    const hands = handTracker.detect(video);
    overlay.drawHands(hands);

    animationFrameId = requestAnimationFrame(runFrame);
  }
}
