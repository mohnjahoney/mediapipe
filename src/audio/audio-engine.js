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
  const mouthGain = new GainNode(context, { gain: 0 });
  const eyeGain = new GainNode(context, { gain: 0 });
  const masterGain = new GainNode(context, { gain: 0.85 });

  mouthOsc.connect(mouthGain);
  eyeOsc.connect(eyeGain);
  mouthGain.connect(masterGain);
  eyeGain.connect(masterGain);
  masterGain.connect(context.destination);
  mouthOsc.start();
  eyeOsc.start();

  return {
    context,

    async start() {
      await context.resume();
    },

    setFrequencies({ mouthFrequency, eyeFrequency }) {
      const now = context.currentTime;
      mouthOsc.frequency.setValueAtTime(mouthFrequency, now);
      eyeOsc.frequency.setValueAtTime(eyeFrequency, now);
    },

    setVolumes({ mouthVolume, eyeVolume }) {
      const now = context.currentTime;
      mouthGain.gain.setValueAtTime(mouthVolume * 0.16, now);
      eyeGain.gain.setValueAtTime(eyeVolume * 0.12, now);
    },

    stop() {
      mouthGain.gain.setTargetAtTime(0, context.currentTime, 0.04);
      eyeGain.gain.setTargetAtTime(0, context.currentTime, 0.04);

      window.setTimeout(() => {
        mouthOsc.stop();
        eyeOsc.stop();
        context.close();
      }, 150);
    },
  };
}
