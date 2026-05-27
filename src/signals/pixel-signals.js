const RED_SAMPLE_POINT = { x: 0.15, y: 0.15 };

export function createRedPixelSampler() {
  const canvas = document.createElement("canvas");
  canvas.width = 1;
  canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });

  return {
    point: RED_SAMPLE_POINT,

    sample(video) {
      if (!video.videoWidth || !video.videoHeight) {
        return { redPixel: 0 };
      }

      const x = Math.floor(video.videoWidth * RED_SAMPLE_POINT.x);
      const y = Math.floor(video.videoHeight * RED_SAMPLE_POINT.y);
      ctx.drawImage(video, x, y, 1, 1, 0, 0, 1, 1);

      return {
        redPixel: ctx.getImageData(0, 0, 1, 1).data[0] / 255,
      };
    },
  };
}
