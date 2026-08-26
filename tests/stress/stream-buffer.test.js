const cpal = require('../..');
const assert = require('assert');
const {
  sleep,
  generateSineWave,
  getTestDevice,
  getTestConfig,
} = require('../helpers/hardware');

describe('Stream Buffer Tests', () => {
  let outputDevice;
  let outputStream;
  let config;

  before(function () {
    outputDevice = getTestDevice(false);
    if (!outputDevice) {
      this.skip();
    }

    config = getTestConfig(outputDevice, false);
    if (!config) {
      this.skip();
    }
  });

  beforeEach(() => {
    outputStream = cpal.createStream(
      outputDevice.deviceId,
      false,
      config,
      () => {}
    );
  });

  afterEach(() => {
    if (outputStream) {
      cpal.closeStream(outputStream);
      outputStream = null;
    }
  });

  it('should handle rapid sequential writes', async () => {
    // Generate 10 short beeps
    const beeps = [];
    for (let i = 0; i < 10; i++) {
      beeps.push(
        generateSineWave(
          440 + i * 50, // Increasing frequency
          config.sampleRate,
          config.channels,
          0.1, // 100ms each
          0.3 // 30% volume
        )
      );
    }

    // Write them in rapid succession
    for (const beep of beeps) {
      cpal.writeToStream(outputStream, beep);
    }

    assert(cpal.isStreamActive(outputStream));
    await sleep(10 * 0.1 * 1000);
  });

  it('should handle alternating frequencies', async () => {
    // Generate alternating high and low tones
    const frequencies = [880, 220]; // High A, Low A

    for (let i = 0; i < 6; i++) {
      const tone = generateSineWave(
        frequencies[i % 2],
        config.sampleRate,
        config.channels,
        0.2,
        0.4
      );

      cpal.writeToStream(outputStream, tone);
      assert(cpal.isStreamActive(outputStream));
      await sleep(0.2 * 1000);
    }
  });

  it('should handle varying buffer sizes', async () => {
    // Test with different buffer sizes
    const bufferSizes = [
      Math.floor(config.sampleRate * config.channels * 0.1), // 100ms
      Math.floor(config.sampleRate * config.channels * 0.5), // 500ms
      Math.floor(config.sampleRate * config.channels * 0.05), // 50ms
      Math.floor(config.sampleRate * config.channels * 1.0), // 1 second
    ];

    for (const size of bufferSizes) {
      // Create a buffer of the specified size
      const buffer = new Float32Array(size);

      // Fill with a sine wave
      const frequency = 440;
      for (let i = 0; i < size / config.channels; i++) {
        const value =
          Math.sin((2 * Math.PI * frequency * i) / config.sampleRate) * 0.5;
        for (let channel = 0; channel < config.channels; channel++) {
          buffer[i * config.channels + channel] = value;
        }
      }

      // Write to the stream
      cpal.writeToStream(outputStream, buffer);
      assert(cpal.isStreamActive(outputStream));

      const durationMs = (size / config.channels / config.sampleRate) * 1000;
      await sleep(durationMs);
    }
  });

  it('should handle buffer overflow gracefully', async () => {
    // Keep the first buffer pending long enough to fill the bounded queue.
    const largeBuffer = generateSineWave(
      440,
      config.sampleRate,
      config.channels,
      1,
      0.5
    );
    let acceptedWrites = 0;
    let bufferFullError;

    for (let i = 0; i < 64; i++) {
      try {
        cpal.writeToStream(outputStream, largeBuffer);
        acceptedWrites++;
      } catch (error) {
        bufferFullError = error;
        break;
      }
    }

    assert(acceptedWrites > 0);
    assert(bufferFullError, 'The bounded stream queue should report overflow');
    assert.match(bufferFullError.message, /buffer full/i);
    assert(cpal.isStreamActive(outputStream));
  });

  it('should handle stereo panning', async function () {
    // Only run this test if we have stereo output
    if (config.channels < 2) {
      this.skip();
    }

    // Create a stereo buffer with sound panned to the left
    const panDuration = 1;
    const leftPan = new Float32Array(
      config.sampleRate * config.channels * panDuration
    );
    for (let i = 0; i < config.sampleRate; i++) {
      const value = Math.sin((2 * Math.PI * 440 * i) / config.sampleRate) * 0.5;
      leftPan[i * config.channels] = value; // Left channel at full volume
      leftPan[i * config.channels + 1] = value * 0.1; // Right channel at 10% volume
    }

    // Write and play left-panned audio
    cpal.writeToStream(outputStream, leftPan);
    assert(cpal.isStreamActive(outputStream));
    await sleep(panDuration * 1000);

    // Create a stereo buffer with sound panned to the right
    const rightPan = new Float32Array(
      config.sampleRate * config.channels * panDuration
    );
    for (let i = 0; i < config.sampleRate; i++) {
      const value = Math.sin((2 * Math.PI * 440 * i) / config.sampleRate) * 0.5;
      rightPan[i * config.channels] = value * 0.1; // Left channel at 10% volume
      rightPan[i * config.channels + 1] = value; // Right channel at full volume
    }

    // Write and play right-panned audio
    cpal.writeToStream(outputStream, rightPan);
    assert(cpal.isStreamActive(outputStream));
    await sleep(panDuration * 1000);
  });
});
