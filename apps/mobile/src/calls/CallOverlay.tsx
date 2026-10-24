import {
  AudioSession,
  LiveKitRoom,
  isTrackReference,
  useLocalParticipant,
  useRNE2EEManager,
  useRoomContext,
  useTracks,
  VideoTrack,
} from "@livekit/react-native";
import { type LocalVideoTrack, Track } from "livekit-client";
import { useEffect, useState } from "react";
import { Modal, Pressable, Vibration, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { Icon, type IconName } from "@/components/Icon";
import { AppText, Avatar } from "@/components/ui";
import { formatDuration } from "@/features/waveform";
import { useConversation } from "@/messaging/hooks";
import { useSession } from "@/state/session";
import type { CallState, EndReason } from "./CallManager";

const ENDED_TEXT: Record<EndReason, string> = {
  hung_up: "Звонок завершён",
  declined: "Звонок отклонён",
  no_answer: "Нет ответа",
  missed: "Пропущенный звонок",
  busy: "Занято",
  failed: "Не удалось соединиться",
  answered_elsewhere: "Ответили на другом устройстве",
};

/** Follows the call manager's state. */
function useCallState(): CallState | null {
  const { calls } = useSession();
  const [state, setState] = useState<CallState | null>(calls?.state ?? null);
  useEffect(() => {
    if (!calls) return;
    setState(calls.state);
    return calls.subscribe(setState);
  }, [calls]);
  return state;
}

/** Shown over the whole app while a call rings or runs; mounted once in the app layout. */
export function CallOverlay() {
  const { calls } = useSession();
  const state = useCallState();
  const [toast, setToast] = useState<EndReason | null>(null);

  // Briefly say how a call ended.
  useEffect(() => {
    if (state?.phase !== "idle" || !state.ended) return;
    setToast(state.ended);
    calls?.dismiss();
    const timer = setTimeout(() => setToast(null), 2500);
    return () => clearTimeout(timer);
  }, [state?.phase, state?.ended]);

  // Vibrate while an incoming call rings.
  useEffect(() => {
    if (state?.phase !== "incoming") return;
    Vibration.vibrate([0, 600, 900], true);
    return () => Vibration.cancel();
  }, [state?.phase]);

  if (!state || !calls) return null;
  const visible = state.phase !== "idle" || !!toast;

  return (
    <Modal visible={visible} animationType="slide" onRequestClose={() => undefined} statusBarTranslucent>
      {state.phase === "idle" ? <Ended reason={toast} /> : <CallScreen state={state} />}
    </Modal>
  );
}

function Ended({ reason }: { reason: EndReason | null }) {
  return (
    <View style={{ flex: 1, backgroundColor: "#0E1117", alignItems: "center", justifyContent: "center" }}>
      <AppText variant="heading" color="#FFFFFF">
        {reason ? ENDED_TEXT[reason] : ""}
      </AppText>
    </View>
  );
}

function CallScreen({ state }: { state: CallState }) {
  const insets = useSafeAreaInsets();
  const { calls } = useSession();
  const { data: chat } = useConversation(state.conversationId ?? "");
  const name = chat?.kind === "group" ? chat.title : (chat?.title ?? "Собеседник");
  const caller = chat?.kind === "group" ? chat.members.find((m) => m.accountId === state.from)?.displayName : null;
  const connected = !!state.url && !!state.token && !!state.key && state.phase !== "incoming";

  return (
    <View style={{ flex: 1, backgroundColor: "#0E1117", paddingTop: insets.top + 24, paddingBottom: insets.bottom + 24 }}>
      {connected ? (
        <Connected state={state} name={name} />
      ) : (
        <View style={{ flex: 1, alignItems: "center", paddingTop: 60, gap: 14 }}>
          <Avatar name={name} seed={state.conversationId ?? ""} size={112} />
          <AppText variant="title" color="#FFFFFF" style={{ textAlign: "center", paddingHorizontal: 24 }}>
            {name}
          </AppText>
          <AppText color="rgba(255,255,255,0.7)" accessibilityLiveRegion="polite">
            {state.phase === "incoming"
              ? `${caller ? `${caller}: ` : ""}${state.video ? "видеозвонок" : "аудиозвонок"}`
              : state.phase === "outgoing"
                ? "Вызов…"
                : "Соединение…"}
          </AppText>
          <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
            <Icon name="lock" size={13} color="rgba(255,255,255,0.6)" strokeWidth={2.4} />
            <AppText variant="caption" color="rgba(255,255,255,0.6)">
              Сквозное шифрование
            </AppText>
          </View>
        </View>
      )}

      {state.phase === "incoming" ? (
        <View style={{ flexDirection: "row", justifyContent: "space-around", paddingHorizontal: 40 }}>
          <RoundButton icon="callEnd" label="Отклонить" color="#E5484D" onPress={() => void calls?.decline()} />
          <RoundButton icon={state.video ? "video" : "phone"} label="Ответить" color="#30A46C" onPress={() => void calls?.accept()} />
        </View>
      ) : connected ? null : (
        <View style={{ alignItems: "center" }}>
          <RoundButton icon="callEnd" label="Завершить" color="#E5484D" onPress={() => void calls?.hangUp()} />
        </View>
      )}
    </View>
  );
}

/** In the room: video tiles (or the name), the timer and controls. */
function Connected({ state, name }: { state: CallState; name: string }) {
  const { e2eeManager } = useRNE2EEManager({ sharedKey: state.key ?? "", dataChannelEncryption: true });

  useEffect(() => {
    void AudioSession.startAudioSession();
    return () => {
      void AudioSession.stopAudioSession();
    };
  }, []);

  return (
    <LiveKitRoom
      serverUrl={state.url ?? ""}
      token={state.token ?? ""}
      connect
      audio
      video={state.video}
      options={{ adaptiveStream: { pixelDensity: "screen" }, encryption: { e2eeManager } }}
    >
      <RoomView state={state} name={name} />
    </LiveKitRoom>
  );
}

function RoomView({ state, name }: { state: CallState; name: string }) {
  const { calls } = useSession();
  const room = useRoomContext();
  const { localParticipant, isMicrophoneEnabled, isCameraEnabled } = useLocalParticipant();
  const tracks = useTracks([Track.Source.Camera], { onlySubscribed: false });
  const [encrypted, setEncrypted] = useState(false);
  const [front, setFront] = useState(true);
  const [now, setNow] = useState(Date.now());

  // Media is encrypted on the phone; the call shows a warning if that ever fails.
  useEffect(() => {
    let alive = true;
    room
      .setE2EEEnabled(true)
      .then(() => alive && setEncrypted(room.isE2EEEnabled))
      .catch(() => alive && setEncrypted(false));
    return () => {
      alive = false;
    };
  }, [room]);

  useEffect(() => {
    const timer = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

  const remote = tracks.filter((t) => isTrackReference(t) && !t.participant.isLocal);
  const mine = tracks.find((t) => isTrackReference(t) && t.participant.isLocal);
  const others = room.remoteParticipants.size;

  async function flipCamera() {
    const camera = localParticipant.getTrackPublication(Track.Source.Camera)?.track as LocalVideoTrack | undefined;
    if (!camera) return;
    await camera.restartTrack({ facingMode: front ? "environment" : "user" });
    setFront(!front);
  }

  return (
    <View style={{ flex: 1 }}>
      <View style={{ flex: 1, gap: 6, paddingHorizontal: 6 }}>
        {state.video && remote.length > 0 ? (
          remote.map((t) =>
            isTrackReference(t) ? <VideoTrack key={t.participant.identity} trackRef={t} style={{ flex: 1, borderRadius: 18, overflow: "hidden" }} objectFit="cover" /> : null,
          )
        ) : (
          <View style={{ flex: 1, alignItems: "center", paddingTop: 60, gap: 14 }}>
            <Avatar name={name} seed={state.conversationId ?? ""} size={112} />
            <AppText variant="title" color="#FFFFFF" style={{ textAlign: "center", paddingHorizontal: 24 }}>
              {name}
            </AppText>
          </View>
        )}
        {state.video && mine && isTrackReference(mine) && isCameraEnabled ? (
          <VideoTrack trackRef={mine} mirror={front} style={{ position: "absolute", right: 18, bottom: 18, width: 110, height: 160, borderRadius: 14, overflow: "hidden" }} objectFit="cover" />
        ) : null}
      </View>

      <View style={{ alignItems: "center", gap: 6, paddingVertical: 14 }}>
        <AppText color="#FFFFFF" style={{ fontVariant: ["tabular-nums"] }} accessibilityLiveRegion="polite">
          {state.phase === "outgoing" ? "Вызов…" : others === 0 ? "Ожидание собеседника…" : formatDuration(now - (state.startedAt ?? now))}
        </AppText>
        <View style={{ flexDirection: "row", alignItems: "center", gap: 6 }}>
          <Icon name={encrypted ? "lock" : "warning"} size={13} color={encrypted ? "rgba(255,255,255,0.6)" : "#F5A623"} strokeWidth={2.4} />
          <AppText variant="caption" color={encrypted ? "rgba(255,255,255,0.6)" : "#F5A623"}>
            {encrypted ? "Сквозное шифрование" : "Шифрование звонка не включилось"}
          </AppText>
        </View>
      </View>

      <View style={{ flexDirection: "row", justifyContent: "space-evenly", alignItems: "center" }}>
        <RoundButton
          icon={isMicrophoneEnabled ? "mic" : "micOff"}
          label={isMicrophoneEnabled ? "Выключить микрофон" : "Включить микрофон"}
          color={isMicrophoneEnabled ? "rgba(255,255,255,0.16)" : "#FFFFFF"}
          iconColor={isMicrophoneEnabled ? "#FFFFFF" : "#0E1117"}
          onPress={() => void localParticipant.setMicrophoneEnabled(!isMicrophoneEnabled)}
        />
        <RoundButton
          icon={isCameraEnabled ? "video" : "videoOff"}
          label={isCameraEnabled ? "Выключить камеру" : "Включить камеру"}
          color={isCameraEnabled ? "rgba(255,255,255,0.16)" : "#FFFFFF"}
          iconColor={isCameraEnabled ? "#FFFFFF" : "#0E1117"}
          onPress={() => void localParticipant.setCameraEnabled(!isCameraEnabled)}
        />
        {isCameraEnabled ? <RoundButton icon="flip" label="Сменить камеру" color="rgba(255,255,255,0.16)" onPress={() => void flipCamera()} /> : null}
        <RoundButton icon="callEnd" label="Завершить" color="#E5484D" onPress={() => void calls?.hangUp()} />
      </View>
    </View>
  );
}

function RoundButton({ icon, label, color, iconColor = "#FFFFFF", onPress }: { icon: IconName; label: string; color: string; iconColor?: string; onPress: () => void }) {
  return (
    <View style={{ alignItems: "center", gap: 8 }}>
      <Pressable
        accessibilityRole="button"
        accessibilityLabel={label}
        onPress={onPress}
        style={({ pressed }) => ({ width: 66, height: 66, borderRadius: 33, backgroundColor: color, alignItems: "center", justifyContent: "center", opacity: pressed ? 0.75 : 1 })}
      >
        <Icon name={icon} size={28} color={iconColor} strokeWidth={2} />
      </Pressable>
      <AppText variant="caption" color="rgba(255,255,255,0.8)">
        {label}
      </AppText>
    </View>
  );
}
