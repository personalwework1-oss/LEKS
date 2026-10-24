import * as Sharing from "expo-sharing";
import { useState } from "react";
import { ActivityIndicator, Image, Modal, Pressable, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { formatBytes } from "@/format";
import type { Attachment } from "@/messaging/types";
import { usePalette } from "@/theme";
import { Icon } from "./Icon";
import { AppText, IconButton } from "./ui";

const MAX_WIDTH = 240;
const MAX_HEIGHT = 320;

/** Fits a photo into the bubble, keeping its shape. */
function photoSize(a: Attachment): { width: number; height: number } {
  const w = a.width ?? 4;
  const h = a.height ?? 3;
  const scale = Math.min(MAX_WIDTH / w, MAX_HEIGHT / h);
  return { width: Math.max(120, Math.round(w * scale)), height: Math.max(90, Math.round(h * scale)) };
}

async function open(a: Attachment) {
  if (a.localUri && (await Sharing.isAvailableAsync())) {
    await Sharing.shareAsync(a.localUri, { mimeType: a.mime, dialogTitle: a.name });
  }
}

/**
 * A photo, video or file inside a message bubble. Taps open the photo,
 * download a file, or retry what failed.
 */
export function AttachmentView({
  attachment: a,
  outgoing,
  onDownload,
  onRetry,
}: {
  attachment: Attachment;
  outgoing: boolean;
  onDownload: () => void;
  onRetry: () => void;
}) {
  const p = usePalette();
  const [viewing, setViewing] = useState(false);
  const busy = a.state === "uploading" || a.state === "downloading";
  const failed = a.state === "failed";
  const fg = outgoing ? p.onAccent : p.bubbleInText;
  const muted = outgoing ? "rgba(255,255,255,0.8)" : p.textMuted;

  function press() {
    if (failed) return outgoing ? onRetry() : onDownload();
    if (busy) return;
    if (!a.localUri) return onDownload();
    if (a.kind === "image") setViewing(true);
    else void open(a);
  }

  if (a.kind === "image") {
    const size = photoSize(a);
    const source = a.localUri ? { uri: a.localUri } : a.thumb ? { uri: `data:image/jpeg;base64,${a.thumb}` } : null;
    return (
      <>
        <Pressable
          onPress={press}
          accessibilityRole="imagebutton"
          accessibilityLabel={failed ? "Фото не загрузилось, нажмите, чтобы повторить" : busy ? "Фото загружается" : "Фото, нажмите, чтобы открыть"}
          style={{ width: size.width, height: size.height, borderRadius: 14, overflow: "hidden", backgroundColor: p.surfaceMuted, marginBottom: 4 }}
        >
          {source ? <Image source={source} style={{ width: "100%", height: "100%" }} blurRadius={a.localUri ? 0 : 12} resizeMode="cover" /> : null}
          {busy || failed || !a.localUri ? (
            <View style={{ position: "absolute", inset: 0, alignItems: "center", justifyContent: "center" }}>
              <View style={{ width: 48, height: 48, borderRadius: 24, backgroundColor: "rgba(0,0,0,0.45)", alignItems: "center", justifyContent: "center" }}>
                {busy ? <ActivityIndicator color="#FFFFFF" /> : <Icon name={failed ? "warning" : "download"} size={22} color="#FFFFFF" strokeWidth={2.2} />}
              </View>
            </View>
          ) : null}
        </Pressable>
        <PhotoViewer uri={viewing ? a.localUri : null} onClose={() => setViewing(false)} onShare={() => void open(a)} />
      </>
    );
  }

  const status = busy
    ? a.state === "uploading"
      ? "Отправляется…"
      : "Скачивается…"
    : failed
      ? outgoing
        ? "Не отправлено — нажмите, чтобы повторить"
        : "Не скачалось — нажмите, чтобы повторить"
      : a.localUri
        ? formatBytes(a.size)
        : `${formatBytes(a.size)} · скачать`;

  return (
    <Pressable
      onPress={press}
      accessibilityRole="button"
      accessibilityLabel={`${a.kind === "video" ? "Видео" : "Файл"} ${a.name}, ${status}`}
      style={{ flexDirection: "row", alignItems: "center", gap: 10, minWidth: 200, maxWidth: MAX_WIDTH, paddingVertical: 4, marginBottom: 2 }}
    >
      <View
        style={{
          width: 44,
          height: 44,
          borderRadius: 22,
          backgroundColor: outgoing ? "rgba(255,255,255,0.2)" : p.accentSoft,
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        {busy ? (
          <ActivityIndicator color={outgoing ? "#FFFFFF" : p.accentText} />
        ) : (
          <Icon
            name={failed ? "warning" : !a.localUri ? "download" : a.kind === "video" ? "play" : "file"}
            size={22}
            color={outgoing ? "#FFFFFF" : p.accentText}
            strokeWidth={2}
          />
        )}
      </View>
      <View style={{ flex: 1 }}>
        <AppText color={fg} numberOfLines={2} style={{ fontSize: 15, lineHeight: 20 }}>
          {a.name}
        </AppText>
        <AppText variant="caption" color={muted} numberOfLines={1}>
          {status}
        </AppText>
      </View>
    </Pressable>
  );
}

function PhotoViewer({ uri, onClose, onShare }: { uri: string | null; onClose: () => void; onShare: () => void }) {
  const insets = useSafeAreaInsets();
  return (
    <Modal visible={!!uri} animationType="fade" onRequestClose={onClose} statusBarTranslucent>
      <View style={{ flex: 1, backgroundColor: "#000000" }}>
        {uri ? <Image source={{ uri }} style={{ flex: 1 }} resizeMode="contain" accessibilityLabel="Фото" /> : null}
        <View style={{ position: "absolute", top: insets.top + 8, left: 12, right: 12, flexDirection: "row", justifyContent: "space-between" }}>
          <IconButton icon="close" label="Закрыть" tone="surface" onPress={onClose} />
          <IconButton icon="share" label="Поделиться или сохранить" tone="surface" onPress={onShare} />
        </View>
      </View>
    </Modal>
  );
}
