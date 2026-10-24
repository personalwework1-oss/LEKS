import { RecordingPresets, requestRecordingPermissionsAsync, setAudioModeAsync, useAudioRecorder, useAudioRecorderState } from "expo-audio";
import { File } from "expo-file-system";
import * as Haptics from "expo-haptics";
import { useEffect, useRef, useState } from "react";
import { View } from "react-native";
import { AppText, IconButton } from "@/components/ui";
import type { OutgoingFile } from "@/messaging/messenger";
import { formatDuration, toWaveform } from "./waveform";

export { formatDuration };
import { usePalette } from "@/theme";

/** Longest voice message, like other messengers keep them short. */
const MAX_MS = 15 * 60 * 1000;

/**
 * Shown instead of the text field while recording: time, live level and
 * buttons to throw away or send.
 */
export function VoiceRecorder({ onSend, onCancel, onError }: { onSend: (file: OutgoingFile) => void; onCancel: () => void; onError: (text: string) => void }) {
  const p = usePalette();
  const recorder = useAudioRecorder({ ...RecordingPresets.HIGH_QUALITY, isMeteringEnabled: true });
  const state = useAudioRecorderState(recorder, 100);
  const samples = useRef<number[]>([]);
  const [started, setStarted] = useState(false);
  const finished = useRef(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const permission = await requestRecordingPermissionsAsync();
      if (!permission.granted) {
        onError("Разрешите доступ к микрофону в настройках телефона, чтобы записывать голосовые.");
        return onCancel();
      }
      await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
      await recorder.prepareToRecordAsync();
      if (cancelled) return;
      recorder.record({ forDuration: MAX_MS / 1000 });
      setStarted(true);
      void Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light);
    })().catch(() => {
      onError("Не удалось начать запись.");
      onCancel();
    });
    return () => {
      cancelled = true;
      if (!finished.current) void recorder.stop().catch(() => undefined);
      void setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => undefined);
    };
    // Starts once when shown.
  }, []);

  useEffect(() => {
    if (state.isRecording && typeof state.metering === "number") samples.current.push(state.metering);
  }, [state.durationMillis]);

  async function finish(send: boolean) {
    if (finished.current) return;
    finished.current = true;
    const duration = state.durationMillis;
    await recorder.stop().catch(() => undefined);
    await setAudioModeAsync({ allowsRecording: false, playsInSilentMode: true }).catch(() => undefined);
    const uri = recorder.uri;
    if (!send || !uri || duration < 700) {
      if (uri) new File(uri).delete();
      return onCancel();
    }
    onSend({
      uri,
      name: `voice-${Date.now()}.m4a`,
      mime: "audio/mp4",
      size: new File(uri).size,
      kind: "voice",
      width: null,
      height: null,
      thumb: null,
      duration,
      waveform: toWaveform(samples.current),
    });
  }

  const recent = toWaveform(samples.current.slice(-40), 24);
  return (
    <View style={{ flex: 1, flexDirection: "row", alignItems: "center", gap: 8 }}>
      <IconButton icon="trash" label="Удалить запись" tone="plain" onPress={() => void finish(false)} />
      <View
        accessibilityLiveRegion="polite"
        accessibilityLabel={`Идёт запись, ${formatDuration(state.durationMillis)}`}
        style={{ flex: 1, minHeight: 44, borderRadius: 22, backgroundColor: p.surfaceMuted, flexDirection: "row", alignItems: "center", gap: 10, paddingHorizontal: 14 }}
      >
        <View style={{ width: 10, height: 10, borderRadius: 5, backgroundColor: started ? p.danger : p.textSubtle }} />
        <AppText style={{ fontVariant: ["tabular-nums"], minWidth: 44 }}>{formatDuration(state.durationMillis)}</AppText>
        <View style={{ flex: 1, flexDirection: "row", alignItems: "center", justifyContent: "flex-end", gap: 2, height: 24 }}>
          {recent.map((level, i) => (
            <View key={i} style={{ width: 3, borderRadius: 1.5, height: 4 + level * 20, backgroundColor: p.accent }} />
          ))}
        </View>
      </View>
      <IconButton icon="send" label="Отправить голосовое" tone="accent" onPress={() => void finish(true)} />
    </View>
  );
}

/** Mic button shown when there is nothing typed. */
export function MicButton({ onPress }: { onPress: () => void }) {
  return <IconButton icon="mic" label="Записать голосовое сообщение" tone="accent" onPress={onPress} />;
}

