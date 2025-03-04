const cpal = require('../');
const assert = require('assert');
const {
  sleep,
  generateSineWave,
  getTestDevice,
  getTestConfig,
} = require('./utils');

describe('Stream Buffer Tests', () => {
  let outputDevice;
  let outputStream;
  let config;

  before(() => {
    outputDevice = getTestDevice(false);
    config = getTestConfig(outputDevice, false);
    config.format = 'f32';
  });

  after(() => {
    if (outputStream) {
      try {
        cpal.closeStream(outputStream);
      } catch (e) {
        console.error('Error closing stream:', e);
      }
    }
  });

  beforeEach(() => {
    // Create a fresh stream for each test
    if (outputStream) {
      try {
        cpal.closeStream(outputStream);
      } catch (e) {
        // Ignore errors
      }
    }

    outputStream = cpal.createStream(outputDevice, false, config, () => {});
  });

  afterEach(async () => {
    // Give some time for audio to play between tests
    await sleep(100);
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
      // No sleep - testing rapid writes
    }

    // Wait for all beeps to finish playing
    await sleep(1500);
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
      await sleep(250); // Small gap between tones
    }
  });

  it('should handle varying buffer sizes', async () => {
    // Test with different buffer sizes
    const bufferSizes = [
      config.sampleRate * config.channels * 0.1, // 100ms
      config.sampleRate * config.channels * 0.5, // 500ms
      config.sampleRate * config.channels * 0.05, // 50ms
      config.sampleRate * config.channels * 1.0, // 1 second
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

      // Wait for the buffer to play
      const durationMs = (size / config.channels / config.sampleRate) * 1000;
      await sleep(durationMs + 100); // Add a small buffer
    }
  });

  it('should handle buffer overflow gracefully', async () => {
    // Generate a very large buffer (10 seconds of audio)
    const largeBuffer = generateSineWave(
      440,
      config.sampleRate,
      config.channels,
      10,
      0.5
    );

    // Try to write it multiple times in rapid succession
    // This should test the channel's buffer handling
    for (let i = 0; i < 5; i++) {
      try {
        cpal.writeToStream(outputStream, largeBuffer);
      } catch (e) {
        // If it throws a buffer full error, that's expected behavior
        assert(
          e.message.includes('buffer full'),
          'Should throw buffer full error'
        );
        break;
      }
      // If it doesn't throw, continue the test
      await sleep(10);
    }

    // Give some time for the audio to play
    await sleep(1000);
  });

  it('should handle pause/resume during playback', async () => {
    // Generate a long tone (3 seconds)
    const longTone = generateSineWave(
      440,
      config.sampleRate,
      config.channels,
      3,
      0.5
    );

    // Start playing
    cpal.writeToStream(outputStream, longTone);

    // Wait a bit
    await sleep(500);

    // Pause the stream
    cpal.pauseStream(outputStream);

    // Wait while paused
    await sleep(1000);

    // Resume the stream
    cpal.resumeStream(outputStream);

    // Wait for the rest to play
    await sleep(1500);
  });

  it('should handle stereo panning', async () => {
    // Only run this test if we have stereo output
    if (config.channels < 2) {
      console.log('Skipping stereo test - device does not support stereo');
      return;
    }

    // Create a stereo buffer with sound panned to the left
    const leftPan = new Float32Array(config.sampleRate * config.channels);
    for (let i = 0; i < config.sampleRate; i++) {
      const value = Math.sin((2 * Math.PI * 440 * i) / config.sampleRate) * 0.5;
      leftPan[i * config.channels] = value; // Left channel at full volume
      leftPan[i * config.channels + 1] = value * 0.1; // Right channel at 10% volume
    }

    // Write and play left-panned audio
    cpal.writeToStream(outputStream, leftPan);
    await sleep(1100);

    // Create a stereo buffer with sound panned to the right
    const rightPan = new Float32Array(config.sampleRate * config.channels);
    for (let i = 0; i < config.sampleRate; i++) {
      const value = Math.sin((2 * Math.PI * 440 * i) / config.sampleRate) * 0.5;
      rightPan[i * config.channels] = value * 0.1; // Left channel at 10% volume
      rightPan[i * config.channels + 1] = value; // Right channel at full volume
    }

    // Write and play right-panned audio
    cpal.writeToStream(outputStream, rightPan);
    await sleep(1100);
  });
});
