class AdehqCallCaptureProcessor extends AudioWorkletProcessor {
  constructor() {
    super();
    this.targetRate = 16000;
    this.carry = [];
  }

  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (!channel || channel.length === 0) return true;

    const ratio = sampleRate / this.targetRate;
    const outputLength = Math.max(1, Math.floor(channel.length / ratio));
    const pcm = new Int16Array(outputLength);
    let squareSum = 0;

    for (let i = 0; i < outputLength; i += 1) {
      const start = Math.floor(i * ratio);
      const finish = Math.min(channel.length, Math.floor((i + 1) * ratio));
      let sum = 0;
      let count = 0;
      for (let cursor = start; cursor < finish; cursor += 1) {
        sum += channel[cursor];
        count += 1;
      }
      const sample = Math.max(-1, Math.min(1, count ? sum / count : 0));
      squareSum += sample * sample;
      pcm[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }

    this.port.postMessage(
      { pcm: pcm.buffer, level: Math.sqrt(squareSum / outputLength) },
      [pcm.buffer],
    );
    return true;
  }
}

registerProcessor("adehq-call-capture", AdehqCallCaptureProcessor);
