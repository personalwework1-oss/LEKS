import { useAudioPlayer, useAudioPlayerStatus } from "expo-audio";
import { ActivityIndicator, Pressable, View } from "react-native";
import { formatDuration } from "@/features/waveform";
import type { Attachment } from "@/messaging/types";
import { usePalette } from "@/theme";
import { Icon } from "./Icon";
import { AppText } from "./ui";

const FLAT = Array.from({ length: 32 }, () => 0.15);

/** Play button, loudness bars that fill as it plays, and the time. */
export function VoicePlayer({ attachment: a, outgoing, onDownload, onRetry }: { attachment: Attachment; outgoing: boolean; onDownload: () => void; onRetry: () => void }) {
  const p = usePalette();
  const player = useAudioPlayer(a.localUri ? { uri: a.localUri } : null, { updateInterval: 100 });
  const status = useAudioPlayerStatus(player);
  const busy = a.state === "uploading" || a.state === "downloading";
  const failed = a.state === "failed";
  const total = status.duration > 0 ? status.duration * 1000 : (a.duration ?? 0);
  const progress = total > 0 ? Math.min(1, (status.currentTime * 1000) / total) : 0;
  const bars = a.waveform?.length ? a.waveform : FLAT;
  const filled = outgoing ? "#FFFFFF" : p.accent;
  const empty = outgoing ? "rgba(255,255,255,0.4)" : p.separator;

  function press() {
    if (failed) return outgoing ? onRetry() : onDownload();
    if (!a.localUri) return onDownload();
    if (status.playing) return player.pause();
    if (status.didJustFinish || progress >= 0.99) void player.seekTo(0);
    player.play();
  }

  return (
    <View style={{ flexDirection: "row", alignItems: "center", gap: 10, minWidth: 210, paddingVertical: 2, marginBottom: 2 }}>
      <Pressable
        onPress={press}
        accessibilityRole="button"
        accessibilityLabel={
          failed ? "Голосовое не загрузилось, нажмите, чтобы повторить" : status.playing ? "Пауза" : `Слушать голосовое, ${formatDuration(a.duration ?? total)}`
        }
        style={{ width: 42, height: 42, borderRadius: 21, backgroundColor: outgoing ? "rgba(255,255,255,0.22)" : p.accent, alignItems: "center", justifyContent: "center" }}
      >
        {busy ? (
          <ActivityIndicator color="#FFFFFF" />
        ) : (
          <Icon name={failed ? "warning" : !a.localUri ? "download" : status.playing ? "pause" : "play"} size={20} color="#FFFFFF" strokeWidth={2.2} filled={!failed && !!a.localUri} />
        )}
      </Pressable>
      <View style={{ flex: 1, gap: 4 }}>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 2, height: 26 }} importantForAccessibility="no-hide-descendants">
          {bars.map((level, i) => (
            <View
              key={i}
              style={{ flex: 1, maxWidth: 4, borderRadius: 2, height: 3 + level * 23, backgroundColor: i / bars.length < progress ? filled : empty }}
            />
          ))}
        </View>
        <AppText variant="caption" color={outgoing ? "rgba(255,255,255,0.85)" : p.textMuted} style={{ fontSize: 12, lineHeight: 16 }}>
          {status.playing || progress > 0 ? formatDuration(status.currentTime * 1000) : formatDuration(a.duration ?? total)}
        </AppText>
      </View>
    </View>
  );
}
