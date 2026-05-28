export function createAudioEngine(settings) {
  const context = new AudioContext({ latencyHint: "interactive" });
  const mouthOsc = new OscillatorNode(context, {
    frequency: settings.mouthFrequency,
    type: "square",
  });
  const eyeOsc = new OscillatorNode(context, {
    frequency: settings.eyeFrequency,
    type: "sine",
  });
  const redOsc = new OscillatorNode(context, {
    frequency: settings.redFrequency,
    type: "triangle",
  });
  const mouthGain = new GainNode(context, { gain: 0 });
  const eyeGain = new GainNode(context, { gain: 0 });
  const redGain = new GainNode(context, { gain: 0 });
  const masterGain = new GainNode(context, { gain: 0.85 });

  mouthOsc.connect(mouthGain);
  eyeOsc.connect(eyeGain);
  redOsc.connect(redGain);
  mouthGain.connect(masterGain);
  eyeGain.connect(masterGain);
  redGain.connect(masterGain);
  masterGain.connect(context.destination);
  mouthOsc.start();
  eyeOsc.start();
  redOsc.start();

  return {
    context,

    async start() {
      await context.resume();
    },

    setFrequencies({ mouthFrequency, eyeFrequency, redFrequency }) {
      const now = context.currentTime;
      mouthOsc.frequency.setValueAtTime(mouthFrequency, now);
      eyeOsc.frequency.setValueAtTime(eyeFrequency, now);
      redOsc.frequency.setValueAtTime(redFrequency, now);
    },

    setMappedParams({ mouthFrequency, mouthVolume = 0, eyeVolume = 0, redVolume = 0 }) {
      const now = context.currentTime;
      if (mouthFrequency !== undefined) {
        mouthOsc.frequency.setValueAtTime(mouthFrequency, now);
      }
      mouthGain.gain.setValueAtTime(mouthVolume * 0.16, now);
      eyeGain.gain.setValueAtTime(eyeVolume * 0.12, now);
      redGain.gain.setValueAtTime(redVolume * 0.12, now);
    },

    stop() {
      mouthGain.gain.setTargetAtTime(0, context.currentTime, 0.04);
      eyeGain.gain.setTargetAtTime(0, context.currentTime, 0.04);
      redGain.gain.setTargetAtTime(0, context.currentTime, 0.04);

      window.setTimeout(() => {
        mouthOsc.stop();
        eyeOsc.stop();
        redOsc.stop();
        context.close();
      }, 150);
    },
  };
}
