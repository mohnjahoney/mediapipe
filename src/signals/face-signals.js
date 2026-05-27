import { average, distance, normalize } from "./signal-utils.js";

export function measureFaceSignals(landmarks, thresholds) {
  const mouthWidth = distance(landmarks[61], landmarks[291]);
  const mouthHeight = distance(landmarks[13], landmarks[14]);
  const leftEyeWidth = distance(landmarks[33], landmarks[133]);
  const leftEyeHeight = average(
    distance(landmarks[159], landmarks[145]),
    distance(landmarks[158], landmarks[153])
  );
  const rightEyeWidth = distance(landmarks[362], landmarks[263]);
  const rightEyeHeight = average(
    distance(landmarks[386], landmarks[374]),
    distance(landmarks[385], landmarks[380])
  );

  const mouthRatio = mouthHeight / Math.max(mouthWidth, 0.001);
  const leftEyeRatio = leftEyeHeight / Math.max(leftEyeWidth, 0.001);
  const rightEyeRatio = rightEyeHeight / Math.max(rightEyeWidth, 0.001);

  return {
    mouthOpen: normalize(mouthRatio, 0.02, thresholds.mouth),
    eyeOpen: normalize(average(leftEyeRatio, rightEyeRatio), 0.08, thresholds.eyeOpen),
  };
}
