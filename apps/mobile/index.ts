// Order matters: WebRTC is set up for calls before the app loads, and the
// background call task must be registered at startup.
import "./src/calls/setup";
import "./src/calls/background";
import "expo-router/entry";
