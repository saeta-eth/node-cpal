const cpal = require('../');
const assert = require('assert');
const {
  sleep,
  generateSineWave,
  getTestDevice,
  getTestConfig,
} = require('./utils');

describe('Stream Write Tests', () => {
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

  it('should create an output stream', () => {
    assert(outputStream, 'Should return a valid stream ID');
    assert(
      cpal.isStreamActive(outputStream),
      'Stream should be active after creation'
    );
  });

  it('should write sine wave data to the stream', () => {
    // Generate a 1-second sine wave at 440Hz (A4 note)
    const sineWave = generateSineWave(
      440, // frequency (Hz)
      config.sampleRate,
      config.channels,
      1, // duration (seconds)
      0.5 // volume (50%)
    );

    // Write the data to the stream
    cpal.writeToStream(outputStream, sineWave);

    // No assertion needed - if it doesn't throw, it worked
  });

  it('should write multiple buffers in sequence', async () => {
    // Generate three different tones
    const frequencies = [261.63, 329.63, 392.0]; // C4, E4, G4 (C major chord)

    for (const freq of frequencies) {
      // Generate a short tone (0.3 seconds)
      const tone = generateSineWave(
        freq,
        config.sampleRate,
        config.channels,
        0.3,
        0.5
      );

      // Write to the stream
      cpal.writeToStream(outputStream, tone);

      // Wait for the tone to play
      await sleep(300);
    }
  });

  it('should handle empty buffer gracefully', () => {
    // Create an empty buffer
    const emptyBuffer = new Float32Array(0);

    // Attempt to write the empty buffer - should throw an error
    assert.throws(() => {
      cpal.writeToStream(outputStream, emptyBuffer);
    }, /Invalid buffer size/);
  });

  it('should reject writing to paused stream', async () => {
    // Pause the stream
    cpal.pauseStream(outputStream);

    // Verify stream is paused
    assert(
      !cpal.isStreamActive(outputStream),
      'Stream should be inactive after pausing'
    );

    // Generate some audio data
    const sineWave = generateSineWave(
      440,
      config.sampleRate,
      config.channels,
      0.5,
      0.5
    );

    // Attempt to write to the paused stream - should throw an error
    assert.throws(() => {
      cpal.writeToStream(outputStream, sineWave);
    }, /Stream is not active/);

    // Resume the stream
    cpal.resumeStream(outputStream);

    // Verify stream is active again
    assert(
      cpal.isStreamActive(outputStream),
      'Stream should be active after resuming'
    );
  });

  it('should handle writing large buffers', () => {
    // Generate a longer audio sample (5 seconds)
    const longSineWave = generateSineWave(
      440,
      config.sampleRate,
      config.channels,
      5,
      0.5
    );

    // Write the large buffer to the stream
    cpal.writeToStream(outputStream, longSineWave);

    // No assertion needed - if it doesn't throw, it worked
  });

  it('should close the stream properly', () => {
    // Close the stream
    cpal.closeStream(outputStream);

    // Verify the stream is no longer active
    assert.strictEqual(
      cpal.isStreamActive(outputStream),
      false,
      'Stream should not be active after closing'
    );

    // Reset the stream variable since it's now closed
    outputStream = null;
  });

  it('should reject writing to non-existent stream', () => {
    // Generate some audio data
    const sineWave = generateSineWave(
      440,
      config.sampleRate,
      config.channels,
      0.5,
      0.5
    );

    // Attempt to write to a non-existent stream
    assert.throws(() => {
      cpal.writeToStream('non-existent-stream-id', sineWave);
    }, /Stream not found/);
  });
});
