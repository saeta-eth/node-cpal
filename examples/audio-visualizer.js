/**
 * audio-visualizer.js
 *
 * This example demonstrates how to create a simple terminal-based
 * audio visualizer using node-cpal's input stream capabilities.
 */

// Try to load the module from the parent directory (development) or from node_modules (installed)
let cpal;
try {
  cpal = require('../');
} catch (e) {
  cpal = require('node-cpal');
}

// Configuration
const SAMPLE_RATE = 48000;
const CHANNELS = 1; // Mono for visualization
const DURATION_SECONDS = 30; // Run for 30 seconds
const VISUALIZATION_WIDTH = 50; // Width of the visualization in characters

// Flag to track if we should exit
let shouldExit = false;

// Handle Ctrl+C to exit gracefully
process.on('SIGINT', () => {
  console.log('\nReceived SIGINT. Shutting down...');
  shouldExit = true;
});

// Function to calculate RMS (Root Mean Square) of audio data
function calculateRMS(audioData) {
  let sum = 0;
  for (let i = 0; i < audioData.length; i++) {
    sum += audioData[i] * audioData[i];
  }
  return Math.sqrt(sum / audioData.length);
}

// Function to create a simple terminal visualization
function visualizeAudio(level, width) {
  // Scale the level to the width
  const barLength = Math.floor(level * width);

  // Create the visualization bar
  let bar = '';
  for (let i = 0; i < width; i++) {
    if (i < barLength) {
      // Use different characters based on level for a more dynamic visualization
      if (i > width * 0.8) {
        bar += '█'; // High level
      } else if (i > width * 0.4) {
        bar += '▓'; // Medium level
      } else {
        bar += '▒'; // Low level
      }
    } else {
      bar += ' '; // Empty space
    }
  }

  // Add a frame and level indicator
  return `|${bar}| ${(level * 100).toFixed(1)}%`;
}

// Main function
async function main() {
  try {
    // Get the default input device
    let inputDevice;
    try {
      inputDevice = cpal.getDefaultInputDevice();
      console.log(`Using input device: ${inputDevice.name}`);
    } catch (error) {
      console.error('No input device available:', error.message);
      return;
    }

    // Get supported configurations and choose one
    const supportedConfigs = cpal.getSupportedInputConfigs(
      inputDevice.deviceId
    );

    // Find a configuration that supports our desired sample rate and channel count
    let selectedConfig = null;
    for (const config of supportedConfigs) {
      if (
        config.channels >= CHANNELS &&
        config.minSampleRate <= SAMPLE_RATE &&
        config.maxSampleRate >= SAMPLE_RATE
      ) {
        selectedConfig = {
          sampleRate: SAMPLE_RATE,
          channels: CHANNELS,
          sampleFormat: config.sampleFormat,
        };
        break;
      }
    }

    if (!selectedConfig) {
      console.error('No suitable audio configuration found');
      return;
    }

    console.log(
      `Using configuration: ${SAMPLE_RATE} Hz, ${CHANNELS} channels, ${selectedConfig.sampleFormat} format`
    );
    console.log(`\nAudio Visualizer - Running for ${DURATION_SECONDS} seconds`);
    console.log('Make some noise to see the visualization!');
    console.log('Press Ctrl+C to exit early\n');

    // Create an input stream with a callback to process incoming audio
    const stream = cpal.createStream(
      inputDevice.deviceId,
      true, // true for input stream
      selectedConfig,
      (data) => {
        // Calculate the audio level (RMS)
        const level = calculateRMS(data);

        // Apply some scaling to make the visualization more sensitive
        // Adjust this value based on your microphone and environment
        const scaledLevel = Math.min(1.0, level * 5.0);

        // Create and display the visualization
        const visualization = visualizeAudio(scaledLevel, VISUALIZATION_WIDTH);
        process.stdout.write(`\r${visualization}`);

        // Check if we should exit
        if (shouldExit) {
          cpal.closeStream(stream);
          console.log('\nVisualizer stopped');
          process.exit(0);
        }
      }
    );

    console.log('Audio visualizer started. Press Ctrl+C to exit.');

    // Run for the specified duration
    await new Promise((resolve) =>
      setTimeout(resolve, DURATION_SECONDS * 1000)
    );

    // Close the stream
    console.log('\n\nStopping audio visualization...');
    cpal.closeStream(stream);

    console.log('Done!');
  } catch (error) {
    console.error('\nError:', error.message);
  }
}

// Run the main function
main();
