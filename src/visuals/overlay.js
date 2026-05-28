import { DrawingUtils } from "https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.35";
import { FaceLandmarker } from "../media/face-tracker.js";
import { HandLandmarker } from "../media/hand-tracker.js";

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
      drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_TESSELATION, {
        color: "rgba(141, 183, 255, 0.22)",
        lineWidth: 1,
      });
      drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_FACE_OVAL, {
        color: "#8db7ff",
        lineWidth: 2,
      });
      drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_LIPS, {
        color: "#8db7ff",
        lineWidth: 2,
      });
      drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_LEFT_EYE, {
        color: "#d6e4ff",
        lineWidth: 2,
      });
      drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_LEFT_IRIS, {
        color: "#ffffff",
        lineWidth: 2,
      });
      drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_LEFT_EYEBROW, {
        color: "#d6e4ff",
        lineWidth: 2,
      });
      drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_RIGHT_EYE, {
        color: "#d6e4ff",
        lineWidth: 2,
      });
      drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_RIGHT_IRIS, {
        color: "#ffffff",
        lineWidth: 2,
      });
      drawingUtils.drawConnectors(landmarks, FaceLandmarker.FACE_LANDMARKS_RIGHT_EYEBROW, {
        color: "#d6e4ff",
        lineWidth: 2,
      });
    },

    drawHands(hands) {
      for (const landmarks of hands) {
        drawingUtils.drawConnectors(landmarks, HandLandmarker.HAND_CONNECTIONS, {
          color: "#7ff0c8",
          lineWidth: 3,
        });
        drawingUtils.drawLandmarks(landmarks, {
          color: "#ffffff",
          fillColor: "#7ff0c8",
          lineWidth: 1,
          radius: 2,
        });
      }
    },

    drawSampleBox(point, size = 5) {
      const x = point.x * canvas.width;
      const y = point.y * canvas.height;
      const halfSize = size / 2;

      ctx.strokeStyle = "#ffffff";
      ctx.lineWidth = 1;
      ctx.strokeRect(x - halfSize, y - halfSize, size, size);
    },

    drawPoint(point, options = {}) {
      const radius = options.radius ?? 8;
      const color = options.color ?? "#ff3333";
      const x = point.x * canvas.width;
      const y = point.y * canvas.height;

      ctx.beginPath();
      ctx.arc(x, y, radius, 0, Math.PI * 2);
      ctx.fillStyle = color;
      ctx.fill();
    },

    drawLine(start, end, options = {}) {
      const color = options.color ?? "#ffffff";
      const lineWidth = options.lineWidth ?? 3;

      ctx.beginPath();
      ctx.moveTo(start.x * canvas.width, start.y * canvas.height);
      ctx.lineTo(end.x * canvas.width, end.y * canvas.height);
      ctx.strokeStyle = color;
      ctx.lineWidth = lineWidth;
      ctx.stroke();
    },
  };
}
