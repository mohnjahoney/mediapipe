import { DrawingUtils } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35";
import { FaceLandmarker } from "../media/face-tracker.js";

export function createOverlay(canvas) {
  const ctx = canvas.getContext("2d");
  const drawingUtils = new DrawingUtils(ctx);

  return {
    clear() {
      ctx.clearRect(0, 0, canvas.width, canvas.height);
    },

    resizeToVideo(video) {
      const width = video.videoWidth || canvas.clientWidth;
      const height = video.videoHeight || canvas.clientHeight;

      if (canvas.width !== width || canvas.height !== height) {
        canvas.width = width;
        canvas.height = height;
      }
    },

    drawFace(landmarks) {
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
    },
  };
}
