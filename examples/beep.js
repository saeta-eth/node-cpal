/**
 * beep.js
 *
 * This example demonstrates how to create a simple beep sound
 * using node-cpal's output stream capabilities.
 * It plays a 440 Hz sine wave for 1 second.
 */

// Try to load the module from the parent directory (development) or from node_modules (installed)
let cpal;
try {
  cpal = require('../');
} catch (e) {
  cpal = require('node-cpal');
}

// Configuration
const FREQUENCY = 440; // 440 Hz (A4 note)
const DURATION_SECONDS = 1; // Play for 1 second

// Main function
async function main() {
  try {
    // Get the default output device
    let outputDevice;
    try {
      outputDevice = cpal.getDefaultOutputDevice();
      console.log(`Using output device: ${outputDevice.name}`);
    } catch (error) {
      console.error('No output device available:', error.message);
      return;
    }

    // Get the default output configuration
    const selectedConfig = cpal.getDefaultOutputConfig(outputDevice.deviceId);
    console.log(
      `Using configuration: ${selectedConfig.sampleRate} Hz, ${selectedConfig.channels} channels, ${selectedConfig.sampleFormat} format`
    );
    console.log(
      `Playing a ${FREQUENCY} Hz tone for ${DURATION_SECONDS} second(s)...`
    );

    // Create an output stream (isInput = false for output)
    const stream = cpal.createStream(
      outputDevice.deviceId,
      false, // false for output stream
      selectedConfig,
      () => {} // Empty callback for output stream
    );

    // Generate a sine wave
    const sampleCount =
      selectedConfig.sampleRate * selectedConfig.channels * DURATION_SECONDS;
    const bufferSize = 1024; // Process audio in chunks
    let sampleClock = 0;

    // Function to generate the next chunk of audio
    function generateSineWave(size) {
      const buffer = new Float32Array(size);
      for (let i = 0; i < size; i++) {
        // Generate sine wave: sin(2π * frequency * time)
        buffer[i] = Math.sin(
          (2 * Math.PI * FREQUENCY * sampleClock) / selectedConfig.sampleRate
        );
        sampleClock++;
      }
      return buffer;
    }

    // Write audio data in chunks until we've generated the full duration
    let samplesWritten = 0;
    while (samplesWritten < sampleCount) {
      // Calculate how many samples to write in this chunk
      const samplesToWrite = Math.min(bufferSize, sampleCount - samplesWritten);

      // Generate and write the audio data
      const audioData = generateSineWave(samplesToWrite);
      cpal.writeToStream(stream, audioData);

      samplesWritten += samplesToWrite;

      // Show progress
      const progress = Math.min(
        100,
        Math.round((samplesWritten / sampleCount) * 100)
      );
      process.stdout.write(`\rProgress: ${progress}%`);

      // Small delay to prevent overwhelming the audio system
      await new Promise((resolve) => setTimeout(resolve, 10));
    }

    // Wait a bit to ensure all audio is played
    console.log('\nFinishing playback...');
    await new Promise((resolve) => setTimeout(resolve, 500));

    // Close the stream
    cpal.closeStream(stream);
    console.log('Done!');
  } catch (error) {
    console.error('\nError:', error.message);
  }
}

// Run the main function
main();
