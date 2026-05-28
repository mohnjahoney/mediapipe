export const HAND_JOINTS = Object.freeze({
  wrist: 0,
  thumbCmc: 1,
  thumbMcp: 2,
  thumbIp: 3,
  thumbTip: 4,
  indexFingerMcp: 5,
  indexFingerPip: 6,
  indexFingerDip: 7,
  indexFingerTip: 8,
  middleFingerMcp: 9,
  middleFingerPip: 10,
  middleFingerDip: 11,
  middleFingerTip: 12,
  ringFingerMcp: 13,
  ringFingerPip: 14,
  ringFingerDip: 15,
  ringFingerTip: 16,
  pinkyMcp: 17,
  pinkyPip: 18,
  pinkyDip: 19,
  pinkyTip: 20,
});

export function jointIndex(jointName, jointMap = HAND_JOINTS) {
  const index = jointMap[jointName];

  if (!Number.isInteger(index)) {
    throw new Error(`Unknown hand joint: ${jointName}`);
  }

  return index;
}

export function compileJointPair({ from, to }, jointMap = HAND_JOINTS) {
  return {
    from,
    to,
    fromIndex: jointIndex(from, jointMap),
    toIndex: jointIndex(to, jointMap),
  };
}
